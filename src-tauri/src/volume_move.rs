//! Moving an unnamed volume's data into the named volume that replaces it:
//! the named volume is made with compose's own labels (so compose adopts it
//! without a warning), then a throwaway busybox container copies old into
//! new (`cp -a`, as root, the old one mounted read-only). Old volumes are
//! never deleted here.

use crate::engine::map_error;
use crate::error::{AppError, ErrorKind};
use bollard::models::{ContainerCreateBody, HostConfig, Mount, MountType, VolumeCreateRequest};
use bollard::query_parameters::{
    CreateImageOptionsBuilder, LogsOptionsBuilder, RemoveContainerOptionsBuilder,
};
use bollard::Docker;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const HELPER_IMAGE: &str = "busybox:latest";
/// Marks the helper containers, so a stray one is easy to recognise.
pub const HELPER_LABEL: &str = "com.mmeany.dockercontrolcentre.helper";
pub const LABEL_VOLUME: &str = "com.docker.compose.volume";

/// Copies everything (dotfiles too, owners and modes kept), unless the
/// target already holds something.
pub const COPY_SCRIPT: &str = "if [ -n \"$(ls -A /to)\" ]; then echo 'The named volume already holds data, so nothing was copied into it.' >&2; exit 3; fi; cp -a /from/. /to/";

/// One volume's data to move.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequest {
    /// The anonymous volume the data is in now.
    pub from: String,
    /// Its key under the top-level `volumes:`.
    pub key: String,
    /// The named volume's name.
    pub name: String,
}

/// Refuses requests that don't make sense before anything runs.
pub fn check_moves(moves: &[MoveRequest]) -> Result<(), AppError> {
    if moves.is_empty() {
        return Err(AppError::invalid("There's no volume data to move."));
    }
    let (mut froms, mut names) = (HashSet::new(), HashSet::new());
    for m in moves {
        if !crate::volume_audit::is_anonymous_name(&m.from) {
            return Err(AppError::invalid(format!(
                "{} isn't an unnamed volume.",
                m.from
            )));
        }
        if crate::volume_audit::clean_name(&m.name) != m.name
            || crate::volume_audit::clean_name(&m.key) != m.key
        {
            return Err(AppError::invalid(format!(
                "{} isn't a usable volume name.",
                m.name
            )));
        }
        if !froms.insert(&m.from) || !names.insert(&m.name) {
            return Err(AppError::invalid("Each volume can be moved only once."));
        }
    }
    Ok(())
}

/// The named volume, labelled the way compose labels its own.
pub fn volume_request(project: &str, m: &MoveRequest) -> VolumeCreateRequest {
    VolumeCreateRequest {
        name: Some(m.name.clone()),
        driver: Some("local".into()),
        labels: Some(HashMap::from([
            (
                crate::engine::LABEL_PROJECT.to_string(),
                project.to_string(),
            ),
            (LABEL_VOLUME.to_string(), m.key.clone()),
        ])),
        ..Default::default()
    }
}

fn volume_mount(source: &str, target: &str, read_only: bool) -> Mount {
    Mount {
        typ: Some(MountType::VOLUME),
        source: Some(source.into()),
        target: Some(target.into()),
        read_only: Some(read_only),
        ..Default::default()
    }
}

/// A helper container: busybox, as root, no network, with these volumes.
pub fn helper_body(script: &str, mounts: Vec<Mount>) -> ContainerCreateBody {
    ContainerCreateBody {
        image: Some(HELPER_IMAGE.into()),
        cmd: Some(vec!["sh".into(), "-c".into(), script.into()]),
        user: Some("0:0".into()),
        network_disabled: Some(true),
        labels: Some(HashMap::from([(
            HELPER_LABEL.to_string(),
            "volume-copy".to_string(),
        )])),
        host_config: Some(HostConfig {
            mounts: Some(mounts),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// The helper that copies `from` into `to`.
pub fn copy_body(from: &str, to: &str) -> ContainerCreateBody {
    helper_body(
        COPY_SCRIPT,
        vec![
            volume_mount(from, "/from", true),
            volume_mount(to, "/to", false),
        ],
    )
}

/// A helper that reads a volume (the integration test).
#[cfg(all(test, feature = "integration"))]
pub fn read_body(volume: &str, script: &str) -> ContainerCreateBody {
    helper_body(script, vec![volume_mount(volume, "/v", true)])
}

/// How far a move got, for the message when a step fails.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Progress {
    pub saved: usize,
    pub stopped: bool,
    pub copied: usize,
    pub total: usize,
}

impl Progress {
    /// What's true after a failure, in plain words.
    pub fn note(&self) -> String {
        let mut parts = vec![];
        if self.saved > 0 {
            parts.push(if self.saved == 1 {
                "The compose file is saved (the old one is in its .bak).".to_string()
            } else {
                format!(
                    "The {} compose files are saved (the old ones are in .bak files).",
                    self.saved
                )
            });
        }
        if self.copied > 0 {
            parts.push(format!(
                "{} of {} volumes were copied; the copies are kept.",
                self.copied, self.total
            ));
        }
        parts.push("The old volumes are untouched.".into());
        if self.stopped {
            parts.push("The project is stopped: Up starts it again.".into());
        }
        parts.join(" ")
    }
}

// ---------------------------------------------------------------------------
// Against the engine

/// Pulls the helper image if the engine doesn't have it.
pub async fn ensure_helper_image(
    docker: &Docker,
    endpoint: &str,
    emit: &(dyn Fn(String) + Send + Sync),
) -> Result<(), AppError> {
    match docker.inspect_image(HELPER_IMAGE).await {
        Ok(_) => return Ok(()),
        Err(e) => {
            let e = map_error(endpoint, e);
            if e.kind != ErrorKind::NotFound {
                return Err(e);
            }
        }
    }
    emit(format!(
        "Pulling {HELPER_IMAGE} (the helper that copies the data)…"
    ));
    let opts = CreateImageOptionsBuilder::new()
        .from_image("busybox")
        .tag("latest")
        .build();
    let mut events = Box::pin(docker.create_image(Some(opts), None, None));
    while let Some(ev) = events.next().await {
        ev.map_err(|e| map_error(endpoint, e))?;
    }
    emit(format!("Pulled {HELPER_IMAGE}"));
    Ok(())
}

/// Makes the named volume, or checks one that's there was made by compose
/// for this project and key. Returns whether it was made now.
pub async fn ensure_volume(
    docker: &Docker,
    endpoint: &str,
    project: &str,
    m: &MoveRequest,
) -> Result<bool, AppError> {
    match docker.inspect_volume(&m.name).await {
        Ok(v) => {
            let l = v.labels;
            let ours = l.get(crate::engine::LABEL_PROJECT).map(String::as_str) == Some(project)
                && l.get(LABEL_VOLUME) == Some(&m.key);
            if ours {
                Ok(false)
            } else {
                Err(AppError::invalid(format!(
                    "A volume called {} already exists and wasn't made for {project}'s {}.",
                    m.name, m.key
                )))
            }
        }
        Err(e) => {
            let e = map_error(endpoint, e);
            if e.kind != ErrorKind::NotFound {
                return Err(e);
            }
            docker
                .create_volume(volume_request(project, m))
                .await
                .map_err(|e| map_error(endpoint, e))?;
            Ok(true)
        }
    }
}

/// Runs a helper to the end and removes it: its exit code and what it printed.
pub async fn run_helper(
    docker: &Docker,
    endpoint: &str,
    body: ContainerCreateBody,
) -> Result<(i64, String), AppError> {
    let id = docker
        .create_container(None, body)
        .await
        .map_err(|e| map_error(endpoint, e))?
        .id;
    let result = async {
        docker
            .start_container(&id, None)
            .await
            .map_err(|e| map_error(endpoint, e))?;
        let mut wait = Box::pin(docker.wait_container(&id, None));
        let code = match wait.next().await {
            Some(Ok(r)) => r.status_code,
            Some(Err(bollard::errors::Error::DockerContainerWaitError { code, .. })) => code,
            Some(Err(e)) => return Err(map_error(endpoint, e)),
            None => -1,
        };
        let opts = LogsOptionsBuilder::new().stdout(true).stderr(true).build();
        let mut logs = Box::pin(docker.logs(&id, Some(opts)));
        let mut out = String::new();
        while let Some(Ok(chunk)) = logs.next().await {
            out.push_str(&String::from_utf8_lossy(&chunk.into_bytes()));
        }
        Ok((code, out.trim().to_string()))
    }
    .await;
    let rm = RemoveContainerOptionsBuilder::new().force(true).build();
    let _ = docker.remove_container(&id, Some(rm)).await;
    result
}

/// Copies one volume into another with a helper.
pub async fn copy_volume(
    docker: &Docker,
    endpoint: &str,
    from: &str,
    to: &str,
) -> Result<(), AppError> {
    let (code, out) = run_helper(docker, endpoint, copy_body(from, to)).await?;
    if code == 0 {
        Ok(())
    } else {
        Err(AppError::from(if out.is_empty() {
            format!("The copy stopped with exit code {code}.")
        } else {
            out
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn mv(from: &str, name: &str) -> MoveRequest {
        MoveRequest {
            from: from.into(),
            key: "web-cache".into(),
            name: name.into(),
        }
    }

    #[test]
    fn checks_requests_before_running() {
        assert!(check_moves(&[mv(HEX, "shop-web-cache")]).is_ok());
        assert!(check_moves(&[]).is_err());
        assert!(check_moves(&[mv("shop_data", "x")])
            .unwrap_err()
            .message
            .contains("isn't an unnamed volume"));
        assert!(check_moves(&[mv(HEX, "bad name")]).is_err());
        assert!(check_moves(&[mv(HEX, "a"), mv(HEX, "b")])
            .unwrap_err()
            .message
            .contains("only once"));
    }

    #[test]
    fn labels_the_volume_like_compose() {
        let r = volume_request("shop", &mv(HEX, "shop-web-cache"));
        assert_eq!(r.name.as_deref(), Some("shop-web-cache"));
        let l = r.labels.unwrap();
        assert_eq!(l["com.docker.compose.project"], "shop");
        assert_eq!(l["com.docker.compose.volume"], "web-cache");
    }

    #[test]
    fn the_helper_copies_as_root_with_the_old_volume_read_only() {
        let b = copy_body(HEX, "shop-web-cache");
        assert_eq!(b.image.as_deref(), Some(HELPER_IMAGE));
        assert_eq!(b.user.as_deref(), Some("0:0"));
        assert_eq!(b.network_disabled, Some(true));
        assert!(b.cmd.unwrap()[2].contains("cp -a /from/. /to/"));
        let m = b.host_config.unwrap().mounts.unwrap();
        assert_eq!(
            (
                m[0].source.as_deref(),
                m[0].target.as_deref(),
                m[0].read_only
            ),
            (Some(HEX), Some("/from"), Some(true))
        );
        assert_eq!(
            (
                m[1].source.as_deref(),
                m[1].target.as_deref(),
                m[1].read_only
            ),
            (Some("shop-web-cache"), Some("/to"), Some(false))
        );
        assert!(b.labels.unwrap().contains_key(HELPER_LABEL));
    }

    #[test]
    fn says_what_is_done_after_a_failure() {
        let p = Progress {
            saved: 1,
            stopped: true,
            copied: 1,
            total: 2,
        };
        assert_eq!(
            p.note(),
            "The compose file is saved (the old one is in its .bak). 1 of 2 volumes were copied; the copies are kept. The old volumes are untouched. The project is stopped: Up starts it again."
        );
        assert_eq!(Progress::default().note(), "The old volumes are untouched.");
        assert!(Progress {
            saved: 2,
            ..Default::default()
        }
        .note()
        .starts_with("The 2 compose files are saved"));
    }
}
