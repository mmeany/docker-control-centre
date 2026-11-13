//! Container actions and the inspect view, mapped to plain data for the UI.

use crate::engine::{short_id, LABEL_PROJECT, LABEL_SERVICE, LABEL_WORKING_DIR};
use crate::volume_audit::{cause_of, is_anonymous_name, AnonymousCause};
use bollard::models::{ContainerInspectResponse, EndpointSettings, MountPoint, PortBinding};
use bollard::query_parameters::RemoveContainerOptionsBuilder;
use bollard::Docker;
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// What the UI can do to containers.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Pause,
    Unpause,
    Kill,
    /// `force` stops a running container first; `volumes` also removes its
    /// anonymous volumes.
    Remove {
        force: bool,
        volumes: bool,
    },
}

/// One container's outcome; `error` is None when it worked.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub id: String,
    pub error: Option<String>,
}

/// Runs `action` on each container concurrently; one result per id, so the
/// UI can say which failed.
pub async fn run_action(
    docker: &Docker,
    endpoint: &str,
    ids: Vec<String>,
    action: ContainerAction,
) -> Vec<ActionResult> {
    let runs = ids.into_iter().map(|id| async move {
        let r = match action {
            ContainerAction::Start => docker.start_container(&id, None).await,
            ContainerAction::Stop => docker.stop_container(&id, None).await,
            ContainerAction::Restart => docker.restart_container(&id, None).await,
            ContainerAction::Pause => docker.pause_container(&id).await,
            ContainerAction::Unpause => docker.unpause_container(&id).await,
            ContainerAction::Kill => docker.kill_container(&id, None).await,
            ContainerAction::Remove { force, volumes } => {
                let opts = RemoveContainerOptionsBuilder::new()
                    .force(force)
                    .v(volumes)
                    .build();
                docker.remove_container(&id, Some(opts)).await
            }
        };
        ActionResult {
            error: r
                .err()
                .map(|x| crate::engine::map_error(endpoint, x).message),
            id,
        }
    });
    join_all(runs).await
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MountInfo {
    /// bind, volume, tmpfs, npipe, cluster, image.
    pub kind: String,
    /// Volume name (volumes only).
    pub name: String,
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub read_write: bool,
    /// Why Docker made it, for an anonymous volume; None otherwise.
    pub anonymous: Option<AnonymousCause>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    /// "80/tcp".
    pub container_port: String,
    /// "0.0.0.0:8080", one per binding; empty when only exposed.
    pub host: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub name: String,
    pub ip_address: String,
    pub gateway: String,
    pub mac_address: String,
    pub aliases: Vec<String>,
}

/// Everything the container's children and the details pane show.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    pub id: String,
    pub name: String,
    pub image: String,
    pub image_id: String,
    /// Entrypoint and command, as one line.
    pub command: String,
    pub created: String,
    pub state: String,
    pub started_at: String,
    pub finished_at: String,
    pub exit_code: Option<i64>,
    pub error: String,
    /// healthy, unhealthy, starting; empty when there's no health check.
    pub health: String,
    pub restart_policy: String,
    pub restart_count: i64,
    pub platform: String,
    pub working_dir: String,
    pub user: String,
    pub hostname: String,
    pub project: Option<String>,
    pub service: Option<String>,
    pub project_dir: Option<String>,
    pub env: Vec<KeyValue>,
    pub labels: Vec<KeyValue>,
    pub mounts: Vec<MountInfo>,
    pub ports: Vec<PortInfo>,
    /// The ports' hosts come from the configuration (it isn't running, so
    /// nothing is published now): what it publishes when it starts.
    pub ports_configured: bool,
    pub networks: Vec<NetworkInfo>,
}

/// Fills in why each anonymous volume was made, from the image's `VOLUME`
/// paths (None when the image couldn't be read: the cause stays unknown).
pub fn set_mount_causes(d: &mut ContainerDetails, image_volumes: Option<&[String]>) {
    for m in d.mounts.iter_mut().filter(|m| m.anonymous.is_some()) {
        m.anonymous = Some(cause_of(&m.destination, image_volumes));
    }
}

/// Docker's zero time means "never".
fn when(t: Option<String>) -> String {
    t.filter(|s| !s.starts_with("0001-01-01"))
        .unwrap_or_default()
}

/// Joins a command line, quoting arguments that contain spaces.
fn command_line(parts: &[String]) -> String {
    parts
        .iter()
        .map(|p| {
            if p.is_empty() || p.contains(char::is_whitespace) {
                format!("\"{p}\"")
            } else {
                p.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn env_pairs(env: Vec<String>) -> Vec<KeyValue> {
    env.into_iter()
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
        .collect()
}

fn sorted_pairs(m: HashMap<String, String>) -> Vec<KeyValue> {
    let mut v: Vec<KeyValue> = m
        .into_iter()
        .map(|(key, value)| KeyValue { key, value })
        .collect();
    v.sort_by(|a, b| a.key.cmp(&b.key));
    v
}

fn mount_info(m: MountPoint) -> MountInfo {
    let kind = m.typ.map(|t| t.to_string()).unwrap_or_default();
    let name = m.name.unwrap_or_default();
    MountInfo {
        anonymous: (kind == "volume" && is_anonymous_name(&name))
            .then_some(AnonymousCause::Unknown),
        kind,
        name,
        source: m.source.unwrap_or_default(),
        destination: m.destination.unwrap_or_default(),
        mode: m.mode.unwrap_or_default(),
        read_write: m.rw.unwrap_or(true),
    }
}

/// Port number for sorting "8080/tcp".
fn port_number(p: &str) -> u32 {
    p.split('/')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(u32::MAX)
}

fn port_infos(
    published: HashMap<String, Option<Vec<PortBinding>>>,
    exposed: Vec<String>,
) -> Vec<PortInfo> {
    let mut map: HashMap<String, Vec<String>> = exposed.into_iter().map(|p| (p, vec![])).collect();
    for (port, bindings) in published {
        let hosts = map.entry(port).or_default();
        for b in bindings.unwrap_or_default() {
            let ip = b
                .host_ip
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "0.0.0.0".into());
            let ip = if ip.contains(':') {
                format!("[{ip}]")
            } else {
                ip
            };
            // No host port in a configured binding: the engine picks one at start.
            let s = match b.host_port.filter(|p| !p.is_empty()) {
                Some(host) => format!("{ip}:{host}"),
                None => format!("{ip}, any free port"),
            };
            if !hosts.contains(&s) {
                hosts.push(s);
            }
        }
    }
    let mut out: Vec<PortInfo> = map
        .into_iter()
        .map(|(container_port, mut host)| {
            host.sort();
            PortInfo {
                container_port,
                host,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        port_number(&a.container_port)
            .cmp(&port_number(&b.container_port))
            .then(a.container_port.cmp(&b.container_port))
    });
    out
}

fn network_info(name: String, e: EndpointSettings) -> NetworkInfo {
    let mut aliases = e.aliases.unwrap_or_default();
    aliases.extend(e.dns_names.unwrap_or_default());
    aliases.sort();
    aliases.dedup();
    NetworkInfo {
        name,
        ip_address: match (e.ip_address.filter(|s| !s.is_empty()), e.ip_prefix_len) {
            (Some(ip), Some(len)) if len > 0 => format!("{ip}/{len}"),
            (Some(ip), _) => ip,
            (None, _) => String::new(),
        },
        gateway: e.gateway.unwrap_or_default(),
        mac_address: e.mac_address.unwrap_or_default(),
        aliases,
    }
}

pub fn container_details(c: ContainerInspectResponse) -> ContainerDetails {
    let config = c.config.unwrap_or_default();
    let state = c.state.unwrap_or_default();
    let host = c.host_config.unwrap_or_default();
    let net = c.network_settings.unwrap_or_default();
    // Published ports exist only while it runs; otherwise show the bindings it
    // will publish (the same thing the lists show, dimmed).
    let live = net.ports.clone().unwrap_or_default();
    let has_live = live
        .values()
        .any(|b| b.as_ref().is_some_and(|v| !v.is_empty()));
    let up = state.running == Some(true) || state.paused == Some(true);
    let configured = host.port_bindings.clone().unwrap_or_default();
    let ports_configured = !has_live && !up && !configured.is_empty();
    let published = if ports_configured { configured } else { live };
    let labels = config.labels.clone().unwrap_or_default();
    let label = |k: &str| labels.get(k).filter(|v| !v.is_empty()).cloned();

    let mut cmd = config.entrypoint.clone().unwrap_or_default();
    cmd.extend(config.cmd.clone().unwrap_or_default());

    let restart_policy = match host.restart_policy {
        Some(p) => match (
            p.name.map(|n| n.to_string()).unwrap_or_default(),
            p.maximum_retry_count,
        ) {
            (n, Some(max)) if n == "on-failure" && max > 0 => format!("{n} (up to {max} times)"),
            (n, _) if n.is_empty() => "no".into(),
            (n, _) => n,
        },
        None => "no".into(),
    };

    let mut networks: Vec<NetworkInfo> = net
        .networks
        .unwrap_or_default()
        .into_iter()
        .map(|(n, e)| network_info(n, e))
        .collect();
    networks.sort_by(|a, b| a.name.cmp(&b.name));

    let id = c.id.unwrap_or_default();
    let name = c
        .name
        .map(|n| n.trim_start_matches('/').to_string())
        .unwrap_or_else(|| short_id(&id).to_string());
    ContainerDetails {
        name,
        image: config.image.clone().unwrap_or_default(),
        image_id: c.image.unwrap_or_default(),
        command: command_line(&cmd),
        created: when(c.created),
        state: state.status.map(|s| s.to_string()).unwrap_or_default(),
        started_at: when(state.started_at),
        finished_at: when(state.finished_at),
        exit_code: state.exit_code,
        error: state.error.unwrap_or_default(),
        health: state
            .health
            .and_then(|h| h.status)
            .map(|s| s.to_string())
            .filter(|s| s != "none")
            .unwrap_or_default(),
        restart_policy,
        restart_count: c.restart_count.unwrap_or(0),
        platform: c.platform.unwrap_or_default(),
        working_dir: config.working_dir.clone().unwrap_or_default(),
        user: config.user.clone().unwrap_or_default(),
        hostname: config.hostname.clone().unwrap_or_default(),
        project: label(LABEL_PROJECT),
        service: label(LABEL_SERVICE),
        project_dir: label(LABEL_WORKING_DIR),
        env: env_pairs(config.env.clone().unwrap_or_default()),
        labels: sorted_pairs(labels.clone()),
        mounts: c
            .mounts
            .unwrap_or_default()
            .into_iter()
            .map(mount_info)
            .collect(),
        ports: port_infos(published, config.exposed_ports.clone().unwrap_or_default()),
        ports_configured,
        networks,
        id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{
        ContainerConfig, ContainerState, ContainerStateStatusEnum, HostConfig, NetworkSettings,
        RestartPolicy, RestartPolicyNameEnum,
    };

    #[test]
    fn reads_actions_from_the_ui() {
        let a: ContainerAction = serde_json::from_value(
            serde_json::json!({"type": "remove", "force": true, "volumes": false}),
        )
        .unwrap();
        assert_eq!(
            a,
            ContainerAction::Remove {
                force: true,
                volumes: false
            }
        );
        let a: ContainerAction =
            serde_json::from_value(serde_json::json!({"type": "unpause"})).unwrap();
        assert_eq!(a, ContainerAction::Unpause);
    }

    #[test]
    fn maps_inspect() {
        let c = ContainerInspectResponse {
            id: Some("0123456789abcdef".into()),
            name: Some("/shop-web-1".into()),
            image: Some("sha256:abc".into()),
            created: Some("2026-10-26T12:04:05.123Z".into()),
            state: Some(ContainerState {
                status: Some(ContainerStateStatusEnum::EXITED),
                exit_code: Some(137),
                started_at: Some("2026-10-26T12:04:06Z".into()),
                finished_at: Some("0001-01-01T00:00:00Z".into()),
                ..Default::default()
            }),
            config: Some(ContainerConfig {
                image: Some("nginx:1.27".into()),
                entrypoint: Some(vec!["/docker-entrypoint.sh".into()]),
                cmd: Some(vec!["nginx".into(), "-g".into(), "daemon off;".into()]),
                env: Some(vec![
                    "PATH=/usr/bin".into(),
                    "EMPTY=".into(),
                    "BARE".into(),
                    "A=b=c".into(),
                ]),
                exposed_ports: Some(vec!["80/tcp".into(), "443/tcp".into()]),
                labels: Some(HashMap::from([
                    (LABEL_PROJECT.to_string(), "shop".to_string()),
                    ("z".to_string(), "1".to_string()),
                ])),
                ..Default::default()
            }),
            host_config: Some(HostConfig {
                restart_policy: Some(RestartPolicy {
                    name: Some(RestartPolicyNameEnum::ON_FAILURE),
                    maximum_retry_count: Some(3),
                }),
                ..Default::default()
            }),
            network_settings: Some(NetworkSettings {
                ports: Some(HashMap::from([(
                    "80/tcp".to_string(),
                    Some(vec![
                        PortBinding {
                            host_ip: Some("0.0.0.0".into()),
                            host_port: Some("8080".into()),
                        },
                        PortBinding {
                            host_ip: Some("::".into()),
                            host_port: Some("8080".into()),
                        },
                    ]),
                )])),
                networks: Some(HashMap::from([(
                    "shop_default".to_string(),
                    EndpointSettings {
                        ip_address: Some("172.18.0.2".into()),
                        ip_prefix_len: Some(16),
                        aliases: Some(vec!["web".into()]),
                        dns_names: Some(vec!["web".into(), "shop-web-1".into()]),
                        ..Default::default()
                    },
                )])),
                ..Default::default()
            }),
            mounts: Some(vec![MountPoint {
                typ: Some("bind".into()),
                source: Some("/mnt/e/shop/html".into()),
                destination: Some("/usr/share/nginx/html".into()),
                rw: Some(false),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let d = container_details(c);
        assert_eq!(d.name, "shop-web-1");
        assert_eq!(d.command, "/docker-entrypoint.sh nginx -g \"daemon off;\"");
        assert_eq!(d.state, "exited");
        assert_eq!(d.exit_code, Some(137));
        assert_eq!(d.finished_at, "");
        assert_eq!(d.restart_policy, "on-failure (up to 3 times)");
        assert_eq!(d.project.as_deref(), Some("shop"));
        assert_eq!(
            d.env
                .iter()
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("PATH", "/usr/bin"),
                ("EMPTY", ""),
                ("BARE", ""),
                ("A", "b=c")
            ]
        );
        assert_eq!(d.labels.last().unwrap().key, "z");
        assert_eq!(
            d.ports,
            vec![
                PortInfo {
                    container_port: "80/tcp".into(),
                    host: vec!["0.0.0.0:8080".into(), "[::]:8080".into()]
                },
                PortInfo {
                    container_port: "443/tcp".into(),
                    host: vec![]
                },
            ]
        );
        assert!(!d.ports_configured, "live bindings win");
        assert_eq!(d.networks[0].ip_address, "172.18.0.2/16");
        assert_eq!(d.networks[0].aliases, vec!["shop-web-1", "web"]);
        assert_eq!(d.mounts[0].kind, "bind");
        assert!(!d.mounts[0].read_write);
        assert_eq!(d.mounts[0].anonymous, None);
    }

    #[test]
    fn marks_anonymous_volumes_with_their_cause() {
        let vol = |name: &str, dest: &str| MountPoint {
            typ: Some("volume".into()),
            name: Some(name.into()),
            destination: Some(dest.into()),
            ..Default::default()
        };
        let mut d = container_details(ContainerInspectResponse {
            mounts: Some(vec![
                vol(&"a".repeat(64), "/var/lib/postgresql/data"),
                vol(&"b".repeat(64), "/cache"),
                vol("shop_pgdata", "/srv"),
            ]),
            ..Default::default()
        });
        assert_eq!(d.mounts[0].anonymous, Some(AnonymousCause::Unknown));
        assert_eq!(d.mounts[2].anonymous, None);
        set_mount_causes(&mut d, Some(&["/var/lib/postgresql/data".to_string()]));
        assert_eq!(d.mounts[0].anonymous, Some(AnonymousCause::Image));
        assert_eq!(d.mounts[1].anonymous, Some(AnonymousCause::NoSource));
        assert_eq!(d.mounts[2].anonymous, None);
    }

    #[test]
    fn stopped_container_shows_configured_ports() {
        let c = ContainerInspectResponse {
            config: Some(ContainerConfig {
                exposed_ports: Some(vec!["21/tcp".into(), "9000/tcp".into()]),
                ..Default::default()
            }),
            host_config: Some(HostConfig {
                port_bindings: Some(HashMap::from([
                    (
                        "21/tcp".to_string(),
                        Some(vec![PortBinding {
                            host_ip: Some(String::new()),
                            host_port: Some("2121".into()),
                        }]),
                    ),
                    (
                        "9000/tcp".to_string(),
                        Some(vec![PortBinding {
                            host_ip: Some("127.0.0.1".into()),
                            host_port: Some(String::new()),
                        }]),
                    ),
                ])),
                ..Default::default()
            }),
            ..Default::default()
        };
        let d = container_details(c);
        assert!(d.ports_configured);
        assert_eq!(
            d.ports,
            vec![
                PortInfo {
                    container_port: "21/tcp".into(),
                    host: vec!["0.0.0.0:2121".into()]
                },
                PortInfo {
                    container_port: "9000/tcp".into(),
                    host: vec!["127.0.0.1, any free port".into()]
                },
            ]
        );
    }

    #[test]
    fn defaults_when_sparse() {
        let d = container_details(ContainerInspectResponse {
            id: Some("abcdef0123456789".into()),
            ..Default::default()
        });
        assert_eq!(d.name, "abcdef012345");
        assert_eq!(d.restart_policy, "no");
        assert_eq!(d.health, "");
        assert!(d.env.is_empty() && d.ports.is_empty() && d.networks.is_empty());
        assert!(!d.ports_configured);
    }
}

/// Against a real engine (`cargo test --features integration`): a throwaway
/// container from python:3.12-slim, driven through every action, then deleted.
#[cfg(all(test, feature = "integration"))]
mod integration {
    use super::*;
    use crate::engine::Engine;
    use bollard::models::ContainerCreateBody;
    use bollard::query_parameters::CreateContainerOptionsBuilder;

    const IMAGE: &str = "python:3.12-slim";

    async fn state(docker: &Docker, id: &str) -> String {
        container_details(docker.inspect_container(id, None).await.expect("inspect")).state
    }

    async fn ok(docker: &Docker, id: &str, action: ContainerAction) {
        let r = run_action(docker, "test", vec![id.to_string()], action).await;
        assert_eq!(
            r,
            vec![ActionResult {
                id: id.into(),
                error: None
            }],
            "{action:?}"
        );
    }

    #[tokio::test]
    async fn drives_a_container_through_every_action() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        if docker.inspect_image(IMAGE).await.is_err() {
            eprintln!("skipped: {IMAGE} isn't on this engine");
            return;
        }
        let name = format!("dcc-integration-{}", std::process::id());
        let body = ContainerCreateBody {
            image: Some(IMAGE.into()),
            cmd: Some(vec!["sleep".into(), "300".into()]),
            env: Some(vec!["DCC_TEST=1".into()]),
            ..Default::default()
        };
        let id = docker
            .create_container(
                Some(CreateContainerOptionsBuilder::new().name(&name).build()),
                body,
            )
            .await
            .expect("create")
            .id;

        ok(docker, &id, ContainerAction::Start).await;
        assert_eq!(state(docker, &id).await, "running");
        ok(docker, &id, ContainerAction::Pause).await;
        assert_eq!(state(docker, &id).await, "paused");
        ok(docker, &id, ContainerAction::Unpause).await;
        ok(docker, &id, ContainerAction::Restart).await;
        assert_eq!(state(docker, &id).await, "running");
        let d = container_details(docker.inspect_container(&id, None).await.unwrap());
        assert_eq!(d.name, name);
        assert!(d
            .env
            .iter()
            .any(|kv| kv.key == "DCC_TEST" && kv.value == "1"));
        assert_eq!(d.command, "sleep 300");
        ok(docker, &id, ContainerAction::Kill).await;
        assert_eq!(state(docker, &id).await, "exited");

        // Errors come back per container instead of failing the batch.
        let r = run_action(
            docker,
            "test",
            vec![id.clone(), "dcc-no-such-container".into()],
            ContainerAction::Start,
        )
        .await;
        assert!(r[0].error.is_none());
        assert!(r[1].error.is_some());

        ok(
            docker,
            &id,
            ContainerAction::Remove {
                force: true,
                volumes: true,
            },
        )
        .await;
        assert!(
            docker.inspect_container(&id, None).await.is_err(),
            "removed"
        );
    }
}
