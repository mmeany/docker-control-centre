//! The Docker engine: where it is (DOCKER_HOST), the client, and the plain
//! data the UI sees. Mapping from bollard's models lives here so it can be
//! unit-tested without an engine.

use crate::error::{AppError, ErrorKind};
use bollard::models::{
    ContainerInspectResponse, ContainerSummary, EventMessage, PortSummary, SystemInfo,
};
use bollard::{Docker, API_DEFAULT_VERSION};
use serde::Serialize;
use std::time::{Duration, SystemTime};

/// Used when DOCKER_HOST isn't set: the WSL engine exposed on TCP.
pub const DEFAULT_HOST: &str = "tcp://localhost:2375";
/// Seconds before a request (not a stream) gives up.
const TIMEOUT_SECS: u64 = 30;

pub const LABEL_PROJECT: &str = "com.docker.compose.project";
pub const LABEL_SERVICE: &str = "com.docker.compose.service";
pub const LABEL_WORKING_DIR: &str = "com.docker.compose.project.working_dir";
pub const LABEL_CONFIG_FILES: &str = "com.docker.compose.project.config_files";

/// How to reach the engine, parsed from a DOCKER_HOST-style URL.
#[derive(Debug, Clone, PartialEq)]
pub enum Endpoint {
    /// `tcp://host:port` or `http://host:port` (no TLS).
    Http(String),
    /// `npipe://…` (Windows) or `unix://…`.
    Local(String),
}

impl Endpoint {
    /// Parses DOCKER_HOST; empty or missing means [`DEFAULT_HOST`].
    pub fn parse(docker_host: Option<&str>) -> Result<Endpoint, AppError> {
        let raw = docker_host
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_HOST);
        let lower = raw.to_ascii_lowercase();
        if lower.starts_with("tcp://") || lower.starts_with("http://") {
            let rest = &raw[raw.find("://").unwrap() + 3..];
            if rest.is_empty() {
                return Err(AppError::invalid(format!("DOCKER_HOST {raw} has no host.")));
            }
            Ok(Endpoint::Http(raw.to_string()))
        } else if lower.starts_with("npipe://") || lower.starts_with("unix://") {
            Ok(Endpoint::Local(raw.to_string()))
        } else if lower.starts_with("https://") || lower.starts_with("ssh://") {
            Err(AppError::invalid(format!(
                "DOCKER_HOST {raw} needs TLS or SSH, which this version doesn't support yet."
            )))
        } else {
            Err(AppError::invalid(format!(
                "DOCKER_HOST {raw} isn't a tcp://, npipe:// or unix:// address."
            )))
        }
    }

    /// The address as shown in the status bar.
    pub fn display(&self) -> &str {
        match self {
            Endpoint::Http(s) | Endpoint::Local(s) => s,
        }
    }

    pub fn connect(&self) -> Result<Docker, AppError> {
        let r = match self {
            Endpoint::Http(addr) => {
                Docker::connect_with_http(addr, TIMEOUT_SECS, API_DEFAULT_VERSION)
            }
            Endpoint::Local(addr) => {
                Docker::connect_with_local(addr, TIMEOUT_SECS, API_DEFAULT_VERSION)
            }
        };
        r.map_err(|e| {
            AppError::new(
                ErrorKind::Other,
                format!("Couldn't set up a client for {}: {e}", self.display()),
            )
        })
    }
}

/// The engine as configured at start-up. The client connects lazily, so this
/// can't fail because the engine is down.
pub struct Engine {
    pub endpoint: Endpoint,
    client: Result<Docker, AppError>,
}

impl Engine {
    pub fn from_env() -> Engine {
        let host = std::env::var("DOCKER_HOST").ok();
        match Endpoint::parse(host.as_deref()) {
            Ok(endpoint) => {
                let client = endpoint.connect();
                Engine { endpoint, client }
            }
            Err(e) => Engine {
                endpoint: Endpoint::Http(host.unwrap_or_default()),
                client: Err(e),
            },
        }
    }

    pub fn docker(&self) -> Result<&Docker, AppError> {
        self.client.as_ref().map_err(Clone::clone)
    }

    /// Turns a bollard error into something the UI can show.
    pub fn error(&self, e: bollard::errors::Error) -> AppError {
        map_error(self.endpoint.display(), e)
    }
}

pub fn map_error(endpoint: &str, e: bollard::errors::Error) -> AppError {
    use bollard::errors::Error as E;
    let detail = e.to_string();
    let (kind, message) = match &e {
        E::DockerResponseServerError {
            status_code: 404,
            message,
        } => (ErrorKind::NotFound, message.clone()),
        E::DockerResponseServerError {
            status_code,
            message,
        } => (
            ErrorKind::Other,
            format!("The engine refused the request ({status_code}): {message}"),
        ),
        E::RequestTimeoutError => (
            ErrorKind::Other,
            format!("The engine at {endpoint} didn't answer in time."),
        ),
        E::HyperResponseError { .. } | E::IOError { .. } => (
            ErrorKind::Other,
            format!("Can't reach the Docker engine at {endpoint}. Is it running?"),
        ),
        _ => (ErrorKind::Other, detail.clone()),
    };
    AppError {
        kind,
        message,
        detail,
    }
}

// ---------------------------------------------------------------------------
// What the UI sees

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    /// Daemon host name (e.g. the WSL distro's machine name).
    pub name: String,
    pub endpoint: String,
    pub server_version: String,
    pub operating_system: String,
    pub containers: i64,
    pub running: i64,
    pub images: i64,
}

pub fn engine_info(endpoint: &str, i: SystemInfo) -> EngineInfo {
    EngineInfo {
        name: i
            .name
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Docker".into()),
        endpoint: endpoint.to_string(),
        server_version: i.server_version.unwrap_or_default(),
        operating_system: i.operating_system.unwrap_or_default(),
        containers: i.containers.unwrap_or(0),
        running: i.containers_running.unwrap_or(0),
        images: i.images.unwrap_or(0),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerItem {
    pub id: String,
    /// Without the leading "/".
    pub name: String,
    pub image: String,
    /// "sha256:…": links the container to its image.
    pub image_id: String,
    /// created, running, paused, restarting, exited, removing, dead.
    pub state: String,
    /// Human status from the engine ("Up 3 hours", "Exited (0) 2 days ago").
    pub status: String,
    /// From "Exited (137) …"; None while running or never run.
    pub exit_code: Option<i64>,
    /// Health check: "starting", "healthy", "unhealthy", or "" without one.
    pub health: String,
    /// ISO 8601 UTC.
    pub created: String,
    /// "8080→80/tcp", "5432/tcp": what's published now (empty unless running).
    pub ports: Vec<String>,
    /// For a container that isn't running: what it publishes when it runs
    /// (`configured_ports`), filled in by `list_containers`; else empty.
    pub configured_ports: Vec<String>,
    /// Compose project, if it belongs to one.
    pub project: Option<String>,
    pub service: Option<String>,
    /// Compose project folder (a path on the engine's side).
    pub working_dir: Option<String>,
    /// Compose files the project was started from (engine-side paths).
    pub config_files: Vec<String>,
    /// Named or anonymous volumes it mounts (not bind mounts).
    pub volumes: Vec<String>,
    /// Networks it's attached to, by name.
    pub networks: Vec<String>,
}

pub fn container_item(c: ContainerSummary) -> ContainerItem {
    let labels = c.labels.unwrap_or_default();
    let label = |k: &str| labels.get(k).filter(|v| !v.is_empty()).cloned();
    let name = c
        .names
        .unwrap_or_default()
        .into_iter()
        .next()
        .map(|n| n.trim_start_matches('/').to_string())
        .unwrap_or_else(|| short_id(c.id.as_deref().unwrap_or_default()).to_string());
    let created = c
        .created
        .and_then(|s| u64::try_from(s).ok())
        .map(|s| crate::util::iso8601(SystemTime::UNIX_EPOCH + Duration::from_secs(s)))
        .unwrap_or_default();
    let volumes = c
        .mounts
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m.typ.as_deref() == Some("volume"))
        .filter_map(|m| m.name)
        .collect();
    let mut networks: Vec<String> = c
        .network_settings
        .and_then(|n| n.networks)
        .map(|n| n.into_keys().collect())
        .unwrap_or_default();
    networks.sort();
    let status = c.status.unwrap_or_default();
    let health = health_of(
        c.health.and_then(|h| h.status).map(|s| s.to_string()),
        &status,
    );
    ContainerItem {
        exit_code: exit_code_of(&status),
        health,
        id: c.id.unwrap_or_default(),
        name,
        image: c.image.unwrap_or_default(),
        image_id: c.image_id.unwrap_or_default(),
        volumes,
        networks,
        state: c.state.map(|s| s.to_string()).unwrap_or_default(),
        status,
        created,
        ports: format_ports(c.ports.unwrap_or_default()),
        configured_ports: vec![],
        project: label(LABEL_PROJECT),
        service: label(LABEL_SERVICE),
        working_dir: label(LABEL_WORKING_DIR),
        config_files: label(LABEL_CONFIG_FILES)
            .map(|f| {
                f.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The code in "Exited (137) 2 hours ago".
pub fn exit_code_of(status: &str) -> Option<i64> {
    let rest = status.strip_prefix("Exited (")?;
    rest.split(')').next()?.trim().parse().ok()
}

/// Health from the engine's health field, else from "(healthy)" in the status line.
fn health_of(health: Option<String>, status: &str) -> String {
    let h = health.unwrap_or_default();
    if matches!(h.as_str(), "starting" | "healthy" | "unhealthy") {
        return h;
    }
    for s in ["unhealthy", "health: starting", "healthy"] {
        if status.contains(&format!("({s})")) {
            return s.trim_start_matches("health: ").to_string();
        }
    }
    String::new()
}

pub fn short_id(id: &str) -> &str {
    &id[..id.len().min(12)]
}

/// Published ports first, each once (the engine lists IPv4 and IPv6 separately).
fn format_ports(ports: Vec<PortSummary>) -> Vec<String> {
    port_labels(
        ports
            .into_iter()
            .map(|p| {
                let proto = p.typ.map(|t| t.to_string()).unwrap_or_else(|| "tcp".into());
                (p.public_port, p.private_port, proto)
            })
            .collect(),
    )
}

/// (host port, container port, protocol) as "8080→80/tcp", or "80/tcp" when
/// not published; published first, then by port, each once.
fn port_labels(ports: Vec<(Option<u16>, u16, String)>) -> Vec<String> {
    let mut out: Vec<(bool, u16, String)> = ports
        .into_iter()
        .map(|(public, private, proto)| match public {
            Some(public) => (true, public, format!("{public}→{private}/{proto}")),
            None => (false, private, format!("{private}/{proto}")),
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    out.dedup_by(|a, b| a.2 == b.2);
    out.into_iter().map(|(_, _, s)| s).collect()
}

/// The engine's list only reports ports while a container runs: for the
/// others the list shows the configured ones (`configured_ports`).
pub fn needs_configured_ports(c: &ContainerItem) -> bool {
    c.ports.is_empty() && c.state != "running" && c.state != "paused"
}

/// What a container publishes when it runs, from its configuration (host
/// port bindings and exposed ports), labelled as the list labels live ports.
/// A binding without a host port (a random one) shows as the bare port.
pub fn configured_ports(c: &ContainerInspectResponse) -> Vec<String> {
    let split = |key: &str| -> Option<(u16, String)> {
        let (port, proto) = key.split_once('/').unwrap_or((key, "tcp"));
        Some((port.parse().ok()?, proto.to_string()))
    };
    let mut out = vec![];
    let bindings = c
        .host_config
        .as_ref()
        .and_then(|h| h.port_bindings.clone())
        .unwrap_or_default();
    for (key, list) in bindings {
        let Some((private, proto)) = split(&key) else {
            continue;
        };
        let list = list.unwrap_or_default();
        if list.is_empty() {
            out.push((None, private, proto.clone()));
        }
        for b in list {
            let public = b.host_port.and_then(|p| p.parse().ok());
            out.push((public, private, proto.clone()));
        }
    }
    let exposed = c
        .config
        .as_ref()
        .and_then(|c| c.exposed_ports.clone())
        .unwrap_or_default();
    for key in exposed {
        if let Some((private, proto)) = split(&key) {
            // Only when no binding covers it: "80/tcp" beside "8080→80/tcp" is noise.
            if !out.iter().any(|(_, p, pr)| *p == private && *pr == proto) {
                out.push((None, private, proto));
            }
        }
    }
    port_labels(out)
}

/// Sent to the UI over the engine channel.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EngineMessage {
    Connected,
    Disconnected {
        message: String,
    },
    /// Something changed; the UI re-reads lists of `resource`.
    Changed {
        resource: String,
        action: String,
        id: String,
    },
}

/// Engine events the UI cares about; None for noise (exec, health checks, …).
pub fn change_of(e: &EventMessage) -> Option<EngineMessage> {
    let resource = e.typ?.to_string();
    if !matches!(
        resource.as_str(),
        "container" | "image" | "volume" | "network"
    ) {
        return None;
    }
    let action = e.action.clone().unwrap_or_default();
    // "exec_start: sh", "health_status: healthy": the list doesn't change.
    let verb = action.split(':').next().unwrap_or_default();
    if verb.starts_with("exec_")
        || verb == "health_status"
        || verb == "top"
        || verb == "attach"
        || verb == "resize"
    {
        return None;
    }
    let id = e
        .actor
        .as_ref()
        .and_then(|a| a.id.clone())
        .unwrap_or_default();
    Some(EngineMessage::Changed {
        resource,
        action,
        id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{
        ContainerSummaryStateEnum, EventActor, EventMessageTypeEnum, PortSummaryTypeEnum,
    };
    use std::collections::HashMap;

    #[test]
    fn parses_docker_host() {
        assert_eq!(
            Endpoint::parse(None).unwrap(),
            Endpoint::Http(DEFAULT_HOST.into())
        );
        assert_eq!(
            Endpoint::parse(Some("  ")).unwrap(),
            Endpoint::Http(DEFAULT_HOST.into())
        );
        assert_eq!(
            Endpoint::parse(Some("tcp://10.0.0.5:2375")).unwrap(),
            Endpoint::Http("tcp://10.0.0.5:2375".into())
        );
        assert_eq!(
            Endpoint::parse(Some("npipe:////./pipe/docker_engine")).unwrap(),
            Endpoint::Local("npipe:////./pipe/docker_engine".into())
        );
        assert_eq!(
            Endpoint::parse(Some("ssh://me@box")).unwrap_err().kind,
            ErrorKind::Invalid
        );
        assert_eq!(
            Endpoint::parse(Some("tcp://")).unwrap_err().kind,
            ErrorKind::Invalid
        );
        assert_eq!(
            Endpoint::parse(Some("localhost:2375")).unwrap_err().kind,
            ErrorKind::Invalid
        );
    }

    fn port(private: u16, public: Option<u16>, ip: &str) -> PortSummary {
        PortSummary {
            ip: Some(ip.into()),
            private_port: private,
            public_port: public,
            typ: Some(PortSummaryTypeEnum::TCP),
        }
    }

    #[test]
    fn maps_containers() {
        let c = ContainerSummary {
            id: Some("0123456789abcdef".into()),
            names: Some(vec!["/shop-web-1".into()]),
            image: Some("nginx:1.27".into()),
            created: Some(1_793_016_245),
            state: Some(ContainerSummaryStateEnum::RUNNING),
            status: Some("Up 3 hours".into()),
            ports: Some(vec![
                port(80, Some(8080), "0.0.0.0"),
                port(80, Some(8080), "::"),
                port(443, None, ""),
            ]),
            labels: Some(HashMap::from([
                (LABEL_PROJECT.to_string(), "shop".to_string()),
                (LABEL_SERVICE.to_string(), "web".to_string()),
                (LABEL_WORKING_DIR.to_string(), "/mnt/e/shop".to_string()),
                (
                    LABEL_CONFIG_FILES.to_string(),
                    "/mnt/e/shop/compose.yml,/mnt/e/shop/override.yml".to_string(),
                ),
            ])),
            ..Default::default()
        };
        let item = container_item(c);
        assert_eq!(item.name, "shop-web-1");
        assert_eq!(item.state, "running");
        assert_eq!(item.created, "2026-10-26T12:04:05Z");
        assert_eq!(item.ports, vec!["8080→80/tcp", "443/tcp"]);
        assert_eq!(item.project.as_deref(), Some("shop"));
        assert_eq!(item.service.as_deref(), Some("web"));
        assert_eq!(item.working_dir.as_deref(), Some("/mnt/e/shop"));
        assert_eq!(
            item.config_files,
            vec!["/mnt/e/shop/compose.yml", "/mnt/e/shop/override.yml"]
        );

        let bare = container_item(ContainerSummary {
            id: Some("abcdef0123456789".into()),
            ..Default::default()
        });
        assert_eq!(bare.name, "abcdef012345");
        assert_eq!(bare.project, None);
        assert!(bare.ports.is_empty());
        assert!(bare.configured_ports.is_empty());
    }

    #[test]
    fn configured_ports_from_bindings_and_exposed() {
        use bollard::models::{ContainerConfig, HostConfig, PortBinding};
        let bind = |port: &str| PortBinding {
            host_ip: Some(String::new()),
            host_port: Some(port.into()),
        };
        let c = ContainerInspectResponse {
            host_config: Some(HostConfig {
                port_bindings: Some(HashMap::from([
                    ("21/tcp".to_string(), Some(vec![bind("21")])),
                    // IPv4 and IPv6 bindings of one port: listed once.
                    ("80/tcp".to_string(), Some(vec![bind("8080"), bind("8080")])),
                    // No host port: the engine picks one when it starts.
                    ("9000/tcp".to_string(), Some(vec![bind("")])),
                    ("53/udp".to_string(), None),
                ])),
                ..Default::default()
            }),
            config: Some(ContainerConfig {
                exposed_ports: Some(vec!["80/tcp".into(), "443/tcp".into(), "junk".into()]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            configured_ports(&c),
            vec!["21→21/tcp", "8080→80/tcp", "53/udp", "443/tcp", "9000/tcp"]
        );
        assert!(configured_ports(&ContainerInspectResponse::default()).is_empty());
    }

    #[test]
    fn configured_ports_only_for_containers_not_running() {
        let item = |state: &str, ports: Vec<String>| ContainerItem {
            state: state.into(),
            ports,
            ..container_item(ContainerSummary::default())
        };
        assert!(needs_configured_ports(&item("exited", vec![])));
        assert!(needs_configured_ports(&item("created", vec![])));
        assert!(!needs_configured_ports(&item("running", vec![])));
        assert!(!needs_configured_ports(&item("paused", vec![])));
        assert!(!needs_configured_ports(&item(
            "exited",
            vec!["80/tcp".into()]
        )));
    }

    fn event(typ: EventMessageTypeEnum, action: &str) -> EventMessage {
        EventMessage {
            typ: Some(typ),
            action: Some(action.into()),
            actor: Some(EventActor {
                id: Some("abc".into()),
                attributes: None,
            }),
            ..Default::default()
        }
    }

    #[test]
    fn reads_exit_codes_and_health() {
        assert_eq!(exit_code_of("Exited (137) 6 weeks ago"), Some(137));
        assert_eq!(exit_code_of("Exited (0) 2 days ago"), Some(0));
        assert_eq!(exit_code_of("Up 5 days"), None);
        assert_eq!(exit_code_of("Created"), None);
        assert_eq!(health_of(None, "Up 3 hours (unhealthy)"), "unhealthy");
        assert_eq!(
            health_of(None, "Up 3 seconds (health: starting)"),
            "starting"
        );
        assert_eq!(health_of(None, "Up 3 hours (healthy)"), "healthy");
        assert_eq!(health_of(Some("healthy".into()), "Up"), "healthy");
        assert_eq!(health_of(Some("none".into()), "Up 3 hours"), "");
    }

    #[test]
    fn filters_events() {
        assert_eq!(
            change_of(&event(EventMessageTypeEnum::CONTAINER, "start")),
            Some(EngineMessage::Changed {
                resource: "container".into(),
                action: "start".into(),
                id: "abc".into()
            })
        );
        assert_eq!(
            change_of(&event(EventMessageTypeEnum::CONTAINER, "exec_start: sh")),
            None
        );
        assert_eq!(
            change_of(&event(
                EventMessageTypeEnum::CONTAINER,
                "health_status: healthy"
            )),
            None
        );
        assert_eq!(
            change_of(&event(EventMessageTypeEnum::DAEMON, "reload")),
            None
        );
        assert!(change_of(&event(EventMessageTypeEnum::VOLUME, "destroy")).is_some());
    }

    #[test]
    fn serialises_messages_for_the_ui() {
        let v = serde_json::to_value(EngineMessage::Disconnected {
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"type": "disconnected", "message": "x"})
        );
        let v = serde_json::to_value(EngineMessage::Connected).unwrap();
        assert_eq!(v, serde_json::json!({"type": "connected"}));
    }
}

/// Integration tests that pull or remove hello-world take this, so one
/// doesn't delete the image while another has a container using it.
#[cfg(all(test, feature = "integration"))]
pub async fn hello_world_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

/// Against a real engine: `cargo test --features integration` (uses DOCKER_HOST
/// or the default address).
#[cfg(all(test, feature = "integration"))]
mod integration {
    use super::*;
    use bollard::query_parameters::ListContainersOptionsBuilder;

    #[tokio::test]
    async fn talks_to_the_engine() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        docker
            .ping()
            .await
            .map_err(|e| engine.error(e))
            .expect("ping");
        let info = engine_info(
            engine.endpoint.display(),
            docker.info().await.expect("info"),
        );
        assert!(!info.server_version.is_empty());
        let opts = ListContainersOptionsBuilder::new().all(true).build();
        let items: Vec<_> = docker
            .list_containers(Some(opts))
            .await
            .expect("list")
            .into_iter()
            .map(container_item)
            .collect();
        assert_eq!(items.len() as i64, info.containers);
        assert!(items.iter().all(|c| !c.id.is_empty() && !c.name.is_empty()));
        for c in &items {
            let d = crate::containers::container_details(
                docker
                    .inspect_container(&c.id, None)
                    .await
                    .expect("inspect"),
            );
            assert_eq!(d.id, c.id);
            assert_eq!(d.name, c.name);
            assert_eq!(d.state, c.state);
        }
    }
}
