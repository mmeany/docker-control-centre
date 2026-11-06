//! Images, volumes and networks: plain data for the UI, mapped from bollard
//! models, plus image-reference parsing and pull progress (unit-tested).

use crate::containers::KeyValue;
use crate::engine::LABEL_PROJECT;
use crate::util::iso8601;
use bollard::models::{
    CreateImageInfo, ImageHistoryResponseItem, ImageInspect, ImageSummary, Network, Volume,
};
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

fn unix(secs: i64) -> String {
    u64::try_from(secs)
        .map(|s| iso8601(SystemTime::UNIX_EPOCH + Duration::from_secs(s)))
        .unwrap_or_default()
}

fn sorted(m: HashMap<String, String>) -> Vec<KeyValue> {
    let mut v: Vec<KeyValue> = m
        .into_iter()
        .map(|(key, value)| KeyValue { key, value })
        .collect();
    v.sort_by(|a, b| a.key.cmp(&b.key));
    v
}

// ---------------------------------------------------------------------------
// Images

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageItem {
    /// "sha256:…".
    pub id: String,
    /// "nginx:1.27"; empty for a dangling image.
    pub tags: Vec<String>,
    pub digests: Vec<String>,
    pub created: String,
    pub size: i64,
}

pub fn image_item(i: ImageSummary) -> ImageItem {
    let mut tags: Vec<String> = i
        .repo_tags
        .into_iter()
        .filter(|t| t != "<none>:<none>")
        .collect();
    tags.sort();
    ImageItem {
        id: i.id,
        tags,
        digests: i
            .repo_digests
            .into_iter()
            .filter(|d| d != "<none>@<none>")
            .collect(),
        created: unix(i.created),
        size: i.size,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    /// "<missing>" for layers built elsewhere.
    pub id: String,
    pub created: String,
    pub created_by: String,
    pub size: i64,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageDetails {
    pub id: String,
    pub tags: Vec<String>,
    pub digests: Vec<String>,
    pub created: String,
    pub size: i64,
    /// "linux/amd64".
    pub platform: String,
    pub author: String,
    pub entrypoint: String,
    pub command: String,
    pub working_dir: String,
    pub user: String,
    pub exposed_ports: Vec<String>,
    pub env: Vec<KeyValue>,
    pub labels: Vec<KeyValue>,
    pub layers: usize,
    pub history: Vec<HistoryItem>,
}

pub fn image_details(i: ImageInspect, history: Vec<ImageHistoryResponseItem>) -> ImageDetails {
    let config = i.config.unwrap_or_default();
    let join = |v: Option<Vec<String>>| v.unwrap_or_default().join(" ");
    let env = config
        .env
        .unwrap_or_default()
        .into_iter()
        .map(|e| match e.split_once('=') {
            Some((k, v)) => KeyValue {
                key: k.into(),
                value: v.into(),
            },
            None => KeyValue {
                key: e,
                value: String::new(),
            },
        })
        .collect();
    let mut exposed = config.exposed_ports.unwrap_or_default();
    exposed.sort();
    let platform = [
        i.os.unwrap_or_default(),
        i.architecture.unwrap_or_default(),
        i.variant.unwrap_or_default(),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join("/");
    let mut tags: Vec<String> = i.repo_tags.unwrap_or_default();
    tags.sort();
    ImageDetails {
        id: i.id.unwrap_or_default(),
        tags,
        digests: i.repo_digests.unwrap_or_default(),
        created: i.created.unwrap_or_default(),
        size: i.size.unwrap_or(0),
        platform,
        author: i.author.unwrap_or_default(),
        entrypoint: join(config.entrypoint),
        command: join(config.cmd),
        working_dir: config.working_dir.unwrap_or_default(),
        user: config.user.unwrap_or_default(),
        exposed_ports: exposed,
        env,
        labels: sorted(config.labels.unwrap_or_default()),
        layers: i
            .root_fs
            .and_then(|r| r.layers)
            .map(|l| l.len())
            .unwrap_or(0),
        history: history
            .into_iter()
            .map(|h| HistoryItem {
                id: h.id,
                created: unix(h.created),
                created_by: h
                    .created_by
                    .trim_start_matches("/bin/sh -c #(nop) ")
                    .trim()
                    .to_string(),
                size: h.size,
                comment: h.comment,
            })
            .collect(),
    }
}

/// "nginx" -> ("nginx", "latest"); "localhost:5000/app:1" -> ("localhost:5000/app", "1");
/// "img@sha256:…" -> ("img@sha256:…", "") (a digest pins it, no tag).
pub fn split_reference(r: &str) -> (String, String) {
    let r = r.trim();
    if r.contains('@') {
        return (r.to_string(), String::new());
    }
    let last_slash = r.rfind('/').map(|i| i + 1).unwrap_or(0);
    match r[last_slash..].rfind(':') {
        Some(i) => (
            r[..last_slash + i].to_string(),
            r[last_slash + i + 1..].to_string(),
        ),
        None => (r.to_string(), "latest".to_string()),
    }
}

/// A layer's progress while pulling.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayerProgress {
    pub id: String,
    /// "Downloading", "Extracting", "Pull complete", "Already exists", …
    pub status: String,
    pub current: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PullMessage {
    /// Every layer so far, plus the latest overall status line.
    Progress {
        layers: Vec<LayerProgress>,
        status: String,
    },
    Done {
        error: Option<String>,
        status: String,
    },
}

/// Folds the engine's progress events into per-layer state (in first-seen order).
#[derive(Default)]
pub struct PullState {
    pub layers: Vec<LayerProgress>,
    pub status: String,
    pub error: Option<String>,
}

impl PullState {
    pub fn apply(&mut self, e: CreateImageInfo) {
        if let Some(err) = e.error_detail.and_then(|d| d.message) {
            self.error = Some(err);
            return;
        }
        let status = e.status.unwrap_or_default();
        let id = e.id.unwrap_or_default();
        // Lines about the image as a whole: "Pulling from library/nginx", "Digest: …", "Status: …".
        if id.is_empty() || status.starts_with("Pulling from") {
            self.status = status;
            return;
        }
        let (current, total) = e
            .progress_detail
            .map(|p| (p.current.unwrap_or(0), p.total.unwrap_or(0)))
            .unwrap_or((0, 0));
        match self.layers.iter_mut().find(|l| l.id == id) {
            Some(l) => {
                l.status = status;
                // Keep the last known size when a status line has none.
                if total > 0 {
                    (l.current, l.total) = (current, total);
                } else if l.status == "Download complete" || l.status == "Pull complete" {
                    l.current = l.total;
                }
            }
            None => self.layers.push(LayerProgress {
                id,
                status,
                current,
                total,
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// Volumes

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeItem {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created: String,
    pub scope: String,
    /// Made by Docker for a container (no name given); prune only removes these by default.
    pub anonymous: bool,
    pub project: Option<String>,
    pub labels: Vec<KeyValue>,
    pub options: Vec<KeyValue>,
}

/// Docker labels anonymous volumes (25+); older engines give them 64-hex names.
pub fn is_anonymous(name: &str, labels: &HashMap<String, String>) -> bool {
    labels.contains_key("com.docker.volume.anonymous")
        || (name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub fn volume_item(v: Volume) -> VolumeItem {
    VolumeItem {
        anonymous: is_anonymous(&v.name, &v.labels),
        project: v
            .labels
            .get(LABEL_PROJECT)
            .filter(|s| !s.is_empty())
            .cloned(),
        name: v.name,
        driver: v.driver,
        mountpoint: v.mountpoint,
        created: v.created_at.unwrap_or_default(),
        scope: v.scope.map(|s| s.to_string()).unwrap_or_default(),
        labels: sorted(v.labels),
        options: sorted(v.options),
    }
}

// ---------------------------------------------------------------------------
// Networks

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkItem {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub created: String,
    pub internal: bool,
    pub attachable: bool,
    pub ipv6: bool,
    /// "172.18.0.0/16".
    pub subnets: Vec<String>,
    pub gateways: Vec<String>,
    /// bridge, host and none: Docker's own, can't be removed.
    pub builtin: bool,
    pub project: Option<String>,
    pub labels: Vec<KeyValue>,
    pub options: Vec<KeyValue>,
}

pub const BUILTIN_NETWORKS: [&str; 3] = ["bridge", "host", "none"];

pub fn network_item(n: Network) -> NetworkItem {
    let name = n.name.unwrap_or_default();
    let labels = n.labels.unwrap_or_default();
    let configs = n.ipam.and_then(|i| i.config).unwrap_or_default();
    NetworkItem {
        id: n.id.unwrap_or_default(),
        builtin: BUILTIN_NETWORKS.contains(&name.as_str()),
        driver: n.driver.unwrap_or_default(),
        scope: n.scope.unwrap_or_default(),
        created: n.created.unwrap_or_default(),
        internal: n.internal.unwrap_or(false),
        attachable: n.attachable.unwrap_or(false),
        ipv6: n.enable_ipv6.unwrap_or(false),
        subnets: configs.iter().filter_map(|c| c.subnet.clone()).collect(),
        gateways: configs.iter().filter_map(|c| c.gateway.clone()).collect(),
        project: labels.get(LABEL_PROJECT).filter(|s| !s.is_empty()).cloned(),
        labels: sorted(labels),
        options: sorted(n.options.unwrap_or_default()),
        name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{ErrorDetail, ImageConfig, Ipam, IpamConfig, ProgressDetail};

    #[test]
    fn maps_images() {
        let i = image_item(ImageSummary {
            id: "sha256:abc".into(),
            repo_tags: vec!["nginx:latest".into(), "nginx:1.27".into()],
            repo_digests: vec!["nginx@sha256:def".into()],
            created: 1_793_016_245,
            size: 42,
            ..Default::default()
        });
        assert_eq!(i.tags, vec!["nginx:1.27", "nginx:latest"]);
        assert_eq!(i.created, "2026-10-26T12:04:05Z");
        let dangling = image_item(ImageSummary {
            repo_tags: vec!["<none>:<none>".into()],
            ..Default::default()
        });
        assert!(dangling.tags.is_empty());
    }

    #[test]
    fn maps_image_details() {
        let d = image_details(
            ImageInspect {
                id: Some("sha256:abc".into()),
                os: Some("linux".into()),
                architecture: Some("arm64".into()),
                variant: Some("v8".into()),
                config: Some(ImageConfig {
                    cmd: Some(vec!["nginx".into(), "-g".into(), "daemon off;".into()]),
                    env: Some(vec!["A=1".into()]),
                    exposed_ports: Some(vec!["80/tcp".into()]),
                    ..Default::default()
                }),
                ..Default::default()
            },
            vec![ImageHistoryResponseItem {
                id: "<missing>".into(),
                created: 0,
                created_by: "/bin/sh -c #(nop)  CMD [\"nginx\"]".into(),
                tags: vec![],
                size: 0,
                comment: String::new(),
            }],
        );
        assert_eq!(d.platform, "linux/arm64/v8");
        assert_eq!(d.command, "nginx -g daemon off;");
        assert_eq!(d.env[0].key, "A");
        assert_eq!(d.history[0].created_by, "CMD [\"nginx\"]");
    }

    #[test]
    fn splits_references() {
        let s = |r: &str| {
            let (a, b) = split_reference(r);
            (a, b)
        };
        assert_eq!(s("nginx"), ("nginx".into(), "latest".into()));
        assert_eq!(s(" nginx:1.27 "), ("nginx".into(), "1.27".into()));
        assert_eq!(
            s("localhost:5000/team/app"),
            ("localhost:5000/team/app".into(), "latest".into())
        );
        assert_eq!(
            s("localhost:5000/team/app:2"),
            ("localhost:5000/team/app".into(), "2".into())
        );
        assert_eq!(
            s("ghcr.io/o/i@sha256:abc"),
            ("ghcr.io/o/i@sha256:abc".into(), "".into())
        );
    }

    fn ev(id: &str, status: &str, cur: i64, total: i64) -> CreateImageInfo {
        CreateImageInfo {
            id: (!id.is_empty()).then(|| id.to_string()),
            status: Some(status.into()),
            progress_detail: (total > 0).then_some(ProgressDetail {
                current: Some(cur),
                total: Some(total),
            }),
            ..Default::default()
        }
    }

    #[test]
    fn folds_pull_progress() {
        let mut p = PullState::default();
        p.apply(ev("1.27", "Pulling from library/nginx", 0, 0));
        p.apply(ev("a", "Pulling fs layer", 0, 0));
        p.apply(ev("b", "Already exists", 0, 0));
        p.apply(ev("a", "Downloading", 50, 200));
        p.apply(ev("a", "Download complete", 0, 0));
        p.apply(ev(
            "",
            "Status: Downloaded newer image for nginx:1.27",
            0,
            0,
        ));
        assert_eq!(p.status, "Status: Downloaded newer image for nginx:1.27");
        assert_eq!(p.layers.len(), 2);
        assert_eq!(
            p.layers[0],
            LayerProgress {
                id: "a".into(),
                status: "Download complete".into(),
                current: 200,
                total: 200
            }
        );
        p.apply(CreateImageInfo {
            error_detail: Some(ErrorDetail {
                code: None,
                message: Some("denied".into()),
            }),
            ..Default::default()
        });
        assert_eq!(p.error.as_deref(), Some("denied"));
    }

    #[test]
    fn maps_volumes_and_networks() {
        let hex = "a".repeat(64);
        let v = volume_item(Volume {
            name: hex.clone(),
            driver: "local".into(),
            ..Default::default()
        });
        assert!(v.anonymous);
        let v = volume_item(Volume {
            name: "shop_data".into(),
            labels: HashMap::from([(LABEL_PROJECT.to_string(), "shop".to_string())]),
            ..Default::default()
        });
        assert!(!v.anonymous);
        assert_eq!(v.project.as_deref(), Some("shop"));

        let n = network_item(Network {
            name: Some("bridge".into()),
            ipam: Some(Ipam {
                config: Some(vec![IpamConfig {
                    subnet: Some("172.17.0.0/16".into()),
                    gateway: Some("172.17.0.1".into()),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        });
        assert!(n.builtin);
        assert_eq!(n.subnets, vec!["172.17.0.0/16"]);
        assert!(
            !network_item(Network {
                name: Some("shop_default".into()),
                ..Default::default()
            })
            .builtin
        );
    }
}

/// Against a real engine (`cargo test --features integration`).
#[cfg(all(test, feature = "integration"))]
mod integration {
    use super::*;
    use crate::engine::Engine;
    use bollard::models::{NetworkCreateRequest, VolumeCreateRequest};
    use bollard::query_parameters::{
        CreateImageOptionsBuilder, ListImagesOptionsBuilder, RemoveImageOptionsBuilder,
    };
    use futures_util::StreamExt;

    #[tokio::test]
    async fn images_volumes_networks() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        let tag = format!("dcc-it-{}", std::process::id());

        // Images: every listed image maps and inspects.
        let images: Vec<ImageItem> = docker
            .list_images(Some(ListImagesOptionsBuilder::new().build()))
            .await
            .expect("images")
            .into_iter()
            .map(image_item)
            .collect();
        assert!(!images.is_empty());
        let first = &images[0];
        let d = image_details(
            docker.inspect_image(&first.id).await.expect("inspect"),
            docker.image_history(&first.id).await.expect("history"),
        );
        assert_eq!(d.id, first.id);
        assert!(!d.platform.is_empty() && !d.history.is_empty());

        // Volumes: a named one maps as named, with our label.
        docker
            .create_volume(VolumeCreateRequest {
                name: Some(tag.clone()),
                labels: Some(HashMap::from([(
                    LABEL_PROJECT.to_string(),
                    "dcc".to_string(),
                )])),
                ..Default::default()
            })
            .await
            .expect("create volume");
        let vols = docker
            .list_volumes(None::<bollard::query_parameters::ListVolumesOptions>)
            .await
            .expect("volumes");
        let v = vols
            .volumes
            .unwrap_or_default()
            .into_iter()
            .map(volume_item)
            .find(|v| v.name == tag)
            .expect("listed");
        assert!(!v.anonymous);
        assert_eq!(v.project.as_deref(), Some("dcc"));
        docker
            .remove_volume(&tag, None::<bollard::query_parameters::RemoveVolumeOptions>)
            .await
            .expect("remove volume");

        // Networks: built-ins flagged; a new one has a subnet.
        let id = docker
            .create_network(NetworkCreateRequest {
                name: tag.clone(),
                ..Default::default()
            })
            .await
            .expect("create network")
            .id;
        let nets: Vec<NetworkItem> = docker
            .list_networks(None)
            .await
            .expect("networks")
            .into_iter()
            .map(network_item)
            .collect();
        assert!(nets.iter().any(|n| n.name == "bridge" && n.builtin));
        let n = nets.iter().find(|n| n.name == tag).expect("listed");
        assert!(!n.builtin && !n.subnets.is_empty(), "{n:?}");
        docker.remove_network(&id).await.expect("remove network");

        // Pull: progress folds to a final status.
        let _hello = crate::engine::hello_world_lock().await;
        let had = docker.inspect_image("hello-world:latest").await.is_ok();
        let (image, t) = split_reference("hello-world");
        let mut events = Box::pin(
            docker.create_image(
                Some(
                    CreateImageOptionsBuilder::new()
                        .from_image(&image)
                        .tag(&t)
                        .build(),
                ),
                None,
                None,
            ),
        );
        let mut state = PullState::default();
        while let Some(e) = events.next().await {
            state.apply(e.expect("pull event"));
        }
        assert!(state.error.is_none(), "{:?}", state.error);
        assert!(state.status.starts_with("Status:"), "{}", state.status);
        if !had {
            docker
                .remove_image(
                    "hello-world:latest",
                    Some(RemoveImageOptionsBuilder::new().build()),
                    None,
                )
                .await
                .expect("remove pulled image");
        }
    }
}
