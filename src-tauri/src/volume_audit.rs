//! Unnamed volumes: the anonymous volumes Docker makes when nothing names a
//! mount, why each was made, and (for a compose project) what to call them.
//!
//! Two causes: an image `VOLUME` nothing mounts over, or a mount given with no
//! source (`docker run -v /data`, compose `- /data`). A project's findings
//! combine its compose config (services, images, volume targets), the images'
//! `VOLUME` paths and the anonymous volumes its containers hold now.

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

/// Why Docker made an anonymous volume.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnonymousCause {
    /// The image declares the path as a `VOLUME` and nothing mounts over it.
    Image,
    /// A mount at that path was given with no source.
    NoSource,
    /// Can't tell (the image is gone, or the config no longer says).
    Unknown,
}

/// Engine-made volume names are 64 hex characters.
pub fn is_anonymous_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

/// "/data/" and "/data" are the same mount point.
fn norm(p: &str) -> &str {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        "/"
    } else {
        t
    }
}

/// The cause of an anonymous volume at `destination`, given the image's
/// `VOLUME` paths (None when the image couldn't be read).
pub fn cause_of(destination: &str, image_volumes: Option<&[String]>) -> AnonymousCause {
    match image_volumes {
        None => AnonymousCause::Unknown,
        Some(v) if v.iter().any(|p| norm(p) == norm(destination)) => AnonymousCause::Image,
        Some(_) => AnonymousCause::NoSource,
    }
}

// ---------------------------------------------------------------------------
// The compose config

/// One service volume entry, as `compose config --format json` gives it.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecMount {
    /// volume, bind, tmpfs, npipe, cluster, image.
    pub kind: String,
    pub source: Option<String>,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServiceSpec {
    pub name: String,
    /// The image it runs: `image:`, or compose's `<project>-<service>` for a
    /// build with no image name.
    pub image: String,
    pub build: bool,
    pub mounts: Vec<SpecMount>,
}

/// What the resolved config says, without its environment or anything else
/// that could hold secrets.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProjectSpec {
    pub name: Option<String>,
    pub services: Vec<ServiceSpec>,
    /// Keys under the top-level `volumes:`.
    pub volume_keys: Vec<String>,
}

fn str_of(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Reads services, images and volume targets from `compose config --format json`.
pub fn parse_config(json: &Value, project: &str) -> ProjectSpec {
    let name = str_of(json, "name");
    let project = name.as_deref().unwrap_or(project);
    let mut services: Vec<ServiceSpec> = json
        .get("services")
        .and_then(|s| s.as_object())
        .map(|m| {
            m.iter()
                .map(|(svc, v)| {
                    let build = v.get("build").is_some_and(|b| !b.is_null());
                    let image = str_of(v, "image").unwrap_or_else(|| format!("{project}-{svc}"));
                    let mut mounts: Vec<SpecMount> = v
                        .get("volumes")
                        .and_then(|x| x.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|m| {
                                    Some(SpecMount {
                                        kind: str_of(m, "type").unwrap_or_else(|| "volume".into()),
                                        source: str_of(m, "source"),
                                        target: str_of(m, "target")?,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    // `tmpfs: [/run]` (or one string) also covers its path.
                    let tmpfs: Vec<String> = match v.get("tmpfs") {
                        Some(Value::String(s)) => vec![s.clone()],
                        Some(Value::Array(a)) => a
                            .iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect(),
                        _ => vec![],
                    };
                    mounts.extend(tmpfs.into_iter().map(|t| SpecMount {
                        kind: "tmpfs".into(),
                        source: None,
                        target: t.split(':').next().unwrap_or_default().to_string(),
                    }));
                    ServiceSpec {
                        name: svc.clone(),
                        image,
                        build,
                        mounts,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    let volume_keys = json
        .get("volumes")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    ProjectSpec {
        name,
        services,
        volume_keys,
    }
}

// ---------------------------------------------------------------------------
// Findings

/// An anonymous volume a project's container mounts now.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveMount {
    pub container: String,
    pub service: String,
    /// The volume's (hex) name.
    pub volume: String,
    pub destination: String,
}

/// What a service's image declares, once looked up.
#[derive(Debug, Clone, PartialEq)]
pub enum ImageVolumes {
    Known(Vec<String>),
    /// Not on the engine: pulled (or built) images only.
    NotLocal,
}

/// A volume a container holds for this finding now.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentVolume {
    pub container: String,
    pub volume: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub service: String,
    /// The path in the container.
    pub target: String,
    pub cause: AnonymousCause,
    /// One per container (replicas each get their own).
    pub current: Vec<CurrentVolume>,
    /// Proposed key under the top-level `volumes:`.
    pub key: String,
    /// Proposed `name:` (what the volumes list shows).
    pub name: String,
}

/// A service whose image couldn't be checked.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Unchecked {
    pub service: String,
    pub image: String,
    /// Built by compose (Build to check) rather than pulled (Pull to check).
    pub build: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnnamedVolumes {
    pub project: String,
    pub findings: Vec<Finding>,
    pub unchecked: Vec<Unchecked>,
    /// Compose couldn't read the files: findings come from the containers only.
    pub config_error: Option<String>,
}

/// Docker volume names: `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Anything else becomes
/// `-`, runs of `-` collapse, and the ends are trimmed.
pub fn clean_name(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let c = if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
            c
        } else {
            '-'
        };
        if c == '-' && out.ends_with('-') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .to_string()
}

/// `db` + `/var/lib/postgresql/data` -> `db-data`.
pub fn proposed_key(service: &str, target: &str) -> String {
    let last = norm(target).rsplit('/').next().unwrap_or_default();
    let last = clean_name(last);
    let key = clean_name(&format!(
        "{service}-{}",
        if last.is_empty() { "data" } else { &last }
    ));
    if key.is_empty() {
        "data".into()
    } else {
        key
    }
}

/// Every unnamed volume in a project, with a key and name for each.
/// `images` is by service; `live` is the anonymous volumes its containers hold.
pub fn find(
    project: &str,
    spec: Option<&ProjectSpec>,
    images: &BTreeMap<String, ImageVolumes>,
    live: &[LiveMount],
) -> (Vec<Finding>, Vec<Unchecked>) {
    // (service, target) -> cause; BTreeMap keeps them in order.
    let mut found: BTreeMap<(String, String), AnonymousCause> = BTreeMap::new();
    let mut unchecked = vec![];
    for s in spec.map(|p| p.services.as_slice()).unwrap_or_default() {
        for m in &s.mounts {
            if m.kind == "volume" && m.source.is_none() {
                found.insert(
                    (s.name.clone(), norm(&m.target).to_string()),
                    AnonymousCause::NoSource,
                );
            }
        }
        match images.get(&s.name) {
            Some(ImageVolumes::Known(paths)) => {
                let covered: HashSet<&str> = s.mounts.iter().map(|m| norm(&m.target)).collect();
                for p in paths.iter().filter(|p| !covered.contains(norm(p))) {
                    found
                        .entry((s.name.clone(), norm(p).to_string()))
                        .or_insert(AnonymousCause::Image);
                }
            }
            Some(ImageVolumes::NotLocal) | None => unchecked.push(Unchecked {
                service: s.name.clone(),
                image: s.image.clone(),
                build: s.build,
            }),
        }
    }
    // What the containers hold; anything the config doesn't explain (it was
    // changed since, or couldn't be read) still shows.
    let mut current: BTreeMap<(String, String), Vec<CurrentVolume>> = BTreeMap::new();
    for l in live {
        let k = (l.service.clone(), norm(&l.destination).to_string());
        found
            .entry(k.clone())
            .or_insert_with(|| match images.get(&l.service) {
                Some(ImageVolumes::Known(v)) => cause_of(&l.destination, Some(v)),
                _ => AnonymousCause::Unknown,
            });
        current.entry(k).or_default().push(CurrentVolume {
            container: l.container.clone(),
            volume: l.volume.clone(),
        });
    }
    let mut taken: HashSet<String> = spec
        .map(|p| p.volume_keys.iter().cloned().collect())
        .unwrap_or_default();
    let findings = found
        .into_iter()
        .map(|((service, target), cause)| {
            let base = proposed_key(&service, &target);
            let mut key = base.clone();
            let mut n = 2;
            while !taken.insert(key.clone()) {
                key = format!("{base}-{n}");
                n += 1;
            }
            let mut cur = current
                .remove(&(service.clone(), target.clone()))
                .unwrap_or_default();
            cur.sort_by(|a, b| a.container.cmp(&b.container));
            Finding {
                name: clean_name(&format!("{project}-{key}")),
                service,
                target,
                cause,
                current: cur,
                key,
            }
        })
        .collect();
    (findings, unchecked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn spots_engine_names() {
        assert!(is_anonymous_name(&"a1".repeat(32)));
        assert!(!is_anonymous_name("shop_pgdata"));
        assert!(!is_anonymous_name(&"g".repeat(64)));
    }

    #[test]
    fn says_why_a_volume_was_made() {
        let img = vec!["/var/lib/postgresql/data".to_string()];
        assert_eq!(
            cause_of("/var/lib/postgresql/data/", Some(&img)),
            AnonymousCause::Image
        );
        assert_eq!(cause_of("/cache", Some(&img)), AnonymousCause::NoSource);
        assert_eq!(cause_of("/cache", None), AnonymousCause::Unknown);
    }

    #[test]
    fn cleans_names() {
        assert_eq!(clean_name("shop-db-data"), "shop-db-data");
        assert_eq!(clean_name("--a b//c__"), "a-b-c");
        assert_eq!(clean_name("é"), "");
        assert_eq!(proposed_key("db", "/var/lib/postgresql/data"), "db-data");
        assert_eq!(proposed_key("web", "/"), "web-data");
        assert_eq!(proposed_key("my app", "/srv/up loads/"), "my-app-up-loads");
    }

    fn config() -> Value {
        json!({
            "name": "shop",
            "services": {
                "db": {
                    "image": "postgres:16",
                    "environment": { "POSTGRES_PASSWORD": "secret" },
                    "volumes": [{ "type": "bind", "source": "/init", "target": "/docker-entrypoint-initdb.d" }]
                },
                "web": {
                    "build": { "context": "." },
                    "volumes": [
                        { "type": "volume", "target": "/cache" },
                        { "type": "volume", "source": "uploads", "target": "/srv/uploads" }
                    ],
                    "tmpfs": ["/run:size=64m"]
                },
                "redis": { "image": "redis:7", "volumes": [{ "type": "volume", "source": "redis", "target": "/data" }] }
            },
            "volumes": { "uploads": {}, "redis": {}, "db-data": {} }
        })
    }

    #[test]
    fn reads_the_config_without_its_environment() {
        let p = parse_config(&config(), "ignored");
        assert_eq!(p.name.as_deref(), Some("shop"));
        assert_eq!(
            p.services
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            ["db", "redis", "web"]
        );
        let web = &p.services[2];
        assert_eq!(web.image, "shop-web");
        assert!(web.build);
        assert_eq!(web.mounts[0].source, None);
        assert_eq!(web.mounts[2].kind, "tmpfs");
        assert_eq!(web.mounts[2].target, "/run");
        assert_eq!(p.volume_keys, ["uploads", "redis", "db-data"]);
    }

    #[test]
    fn finds_image_volumes_and_sourceless_mounts() {
        let p = parse_config(&config(), "shop");
        let images = BTreeMap::from([
            (
                "db".to_string(),
                ImageVolumes::Known(vec!["/var/lib/postgresql/data".into()]),
            ),
            // Covered by the named redis volume.
            (
                "redis".to_string(),
                ImageVolumes::Known(vec!["/data".into()]),
            ),
            ("web".to_string(), ImageVolumes::NotLocal),
        ]);
        let live = vec![
            LiveMount {
                container: "shop-db-1".into(),
                service: "db".into(),
                volume: "a".repeat(64),
                destination: "/var/lib/postgresql/data".into(),
            },
            LiveMount {
                container: "shop-web-1".into(),
                service: "web".into(),
                volume: "b".repeat(64),
                destination: "/cache".into(),
            },
        ];
        let (f, u) = find("shop", Some(&p), &images, &live);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].service, "db");
        assert_eq!(f[0].cause, AnonymousCause::Image);
        // db-data is already a key in the file.
        assert_eq!(f[0].key, "db-data-2");
        assert_eq!(f[0].name, "shop-db-data-2");
        assert_eq!(f[0].current[0].container, "shop-db-1");
        assert_eq!(f[1].target, "/cache");
        assert_eq!(f[1].cause, AnonymousCause::NoSource);
        assert_eq!(f[1].key, "web-cache");
        assert_eq!(
            u,
            [Unchecked {
                service: "web".into(),
                image: "shop-web".into(),
                build: true
            }]
        );
    }

    #[test]
    fn keys_stay_unique_within_a_service() {
        let p = parse_config(
            &json!({ "services": { "app": { "image": "x", "volumes": [
                { "type": "volume", "target": "/a/data" },
                { "type": "volume", "target": "/b/data" }
            ] } } }),
            "p",
        );
        let images = BTreeMap::from([("app".to_string(), ImageVolumes::Known(vec![]))]);
        let (f, _) = find("p", Some(&p), &images, &[]);
        assert_eq!(
            f.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(),
            ["app-data", "app-data-2"]
        );
    }

    #[test]
    fn falls_back_to_the_containers() {
        let live = vec![
            LiveMount {
                container: "p-app-2".into(),
                service: "app".into(),
                volume: "c".repeat(64),
                destination: "/data".into(),
            },
            LiveMount {
                container: "p-app-1".into(),
                service: "app".into(),
                volume: "d".repeat(64),
                destination: "/data/".into(),
            },
        ];
        let images =
            BTreeMap::from([("app".to_string(), ImageVolumes::Known(vec!["/data".into()]))]);
        let (f, u) = find("p", None, &images, &live);
        assert!(u.is_empty());
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].cause, AnonymousCause::Image);
        assert_eq!(
            f[0].current
                .iter()
                .map(|c| c.container.as_str())
                .collect::<Vec<_>>(),
            ["p-app-1", "p-app-2"]
        );
        let (f, _) = find("p", None, &BTreeMap::new(), &live);
        assert_eq!(f[0].cause, AnonymousCause::Unknown);
    }
}
