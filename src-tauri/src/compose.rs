//! Running `docker compose`: inside WSL (`wsl.exe -d <distro> --cd <dir> --
//! docker compose …`, needed when the engine lives in WSL because it resolves
//! bind-mount paths on the Linux side) or on the host. The pure parts (path
//! conversion, distro listing, command lines, which verbs are allowed) are
//! here with tests; the commands live in commands/compose.rs.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// Settings keys (in `values`).
pub const MODE_KEY: &str = "compose.mode";
pub const DISTRO_KEY: &str = "compose.distro";
pub const PINNED_KEY: &str = "compose.pinned";

#[derive(Debug, Clone, PartialEq)]
pub enum Runner {
    /// Through wsl.exe; None = the default distro.
    Wsl { distro: Option<String> },
    /// `docker compose` on this machine.
    Host,
}

impl Runner {
    /// From settings values; WSL is the default on Windows.
    pub fn from_values(
        mode: Option<&serde_json::Value>,
        distro: Option<&serde_json::Value>,
    ) -> Runner {
        let host_default = !cfg!(windows);
        match mode.and_then(|v| v.as_str()) {
            Some("host") => Runner::Host,
            Some("wsl") => Runner::Wsl {
                distro: distro
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
            },
            _ if host_default => Runner::Host,
            _ => Runner::Wsl {
                distro: distro
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
            },
        }
    }
}

/// `E:\a\b` -> `/mnt/e/a/b`; `\\wsl$\Distro\x` or `\\wsl.localhost\Distro\x` -> `/x`.
/// Linux paths pass through. None for anything else (other UNC shares).
pub fn to_wsl_path(p: &str) -> Option<String> {
    let p = p.trim();
    if p.starts_with('/') {
        return Some(p.to_string());
    }
    let unix = p.replace('\\', "/");
    for prefix in ["//wsl$/", "//wsl.localhost/"] {
        if let Some(rest) = unix.strip_prefix(prefix) {
            let after_distro = rest.split_once('/').map(|(_, r)| r).unwrap_or("");
            return Some(format!("/{after_distro}"));
        }
    }
    let b = unix.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        let rest = unix[2..].trim_start_matches('/');
        let drive = (b[0] as char).to_ascii_lowercase();
        return Some(if rest.is_empty() {
            format!("/mnt/{drive}")
        } else {
            format!("/mnt/{drive}/{rest}")
        });
    }
    None
}

/// `/mnt/e/a/b` -> `E:\a\b`; other Linux paths -> `\\wsl.localhost\<distro>\…`.
pub fn to_windows_path(p: &str, distro: &str) -> String {
    let p = p.trim();
    if !p.starts_with('/') {
        return p.to_string();
    }
    let parts: Vec<&str> = p.trim_start_matches('/').split('/').collect();
    if parts.len() >= 2
        && parts[0] == "mnt"
        && parts[1].len() == 1
        && parts[1].as_bytes()[0].is_ascii_alphabetic()
    {
        let drive = parts[1].to_ascii_uppercase();
        let rest = parts[2..].join("\\");
        return format!("{drive}:\\{rest}");
    }
    if distro.is_empty() {
        return p.to_string();
    }
    format!("\\\\wsl.localhost\\{distro}{}", p.replace('/', "\\"))
}

/// The host-side form of a project path, for `Runner::Host`.
pub fn to_host_path(p: &str) -> Result<String, AppError> {
    if !cfg!(windows) || !p.starts_with('/') {
        return Ok(p.to_string());
    }
    if p.starts_with("/mnt/") {
        return Ok(to_windows_path(p, ""));
    }
    Err(AppError::invalid(format!(
        "{p} is inside WSL. Switch Compose to run in WSL (Settings) to manage this project."
    )))
}

/// wsl.exe writes its own messages as UTF-16LE; programs it runs write UTF-8.
pub fn decode_output(bytes: &[u8]) -> String {
    let looks_utf16 = bytes.len() >= 4
        && bytes.len() % 2 == 0
        && bytes
            .iter()
            .skip(1)
            .step_by(2)
            .take(8)
            .filter(|b| **b == 0)
            .count()
            >= 3;
    if looks_utf16 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
            .trim_start_matches('\u{feff}')
            .to_string()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    pub name: String,
    pub default: bool,
    pub running: bool,
    pub version: u8,
}

/// Parses `wsl.exe -l -v` (already decoded).
pub fn parse_distros(text: &str) -> Vec<Distro> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            let default = line.trim_start().starts_with('*');
            let mut cols = line.trim_start().trim_start_matches('*').split_whitespace();
            let name = cols.next()?.to_string();
            let state = cols.next().unwrap_or("");
            let version = cols.next().and_then(|v| v.parse().ok()).unwrap_or(2);
            Some(Distro {
                name,
                default,
                running: state.eq_ignore_ascii_case("Running"),
                version,
            })
        })
        .collect()
}

/// What to run compose against: a project's folder and files (as Windows or
/// Linux paths), and its name when known.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Target {
    pub name: Option<String>,
    pub dir: String,
    pub files: Vec<String>,
}

/// The verbs the UI may run, with their fixed arguments.
pub fn verb_args(verb: &str) -> Result<Vec<&'static str>, AppError> {
    Ok(match verb {
        "up" => vec!["up", "-d", "--remove-orphans"],
        "down" => vec!["down"],
        "down-volumes" => vec!["down", "--volumes"],
        "restart" => vec!["restart"],
        "stop" => vec!["stop"],
        "start" => vec!["start"],
        "pull" => vec!["pull"],
        "config" => vec!["config", "--format", "json"],
        "validate" => vec!["config", "--quiet"],
        // The merged file as YAML, with variables filled in.
        "config-yaml" => vec!["config"],
        "version" => vec!["version"],
        _ => {
            return Err(AppError::invalid(format!(
                "{verb} isn't a compose action this app runs."
            )))
        }
    })
}

/// Program and arguments for running `docker compose <verb>` on a target.
/// Host mode also returns the working directory to start in.
pub fn command_line(
    runner: &Runner,
    target: &Target,
    verb: &str,
) -> Result<(String, Vec<String>, Option<String>), AppError> {
    let verb = verb_args(verb)?;
    let mut compose: Vec<String> = vec!["docker".into(), "compose".into()];
    if let Some(n) = target.name.as_ref().filter(|n| !n.is_empty()) {
        compose.push("-p".into());
        compose.push(n.clone());
    }
    match runner {
        Runner::Wsl { distro } => {
            let mut args: Vec<String> = vec![];
            if let Some(d) = distro {
                args.push("-d".into());
                args.push(d.clone());
            }
            if !target.dir.is_empty() {
                let dir = to_wsl_path(&target.dir)
                    .ok_or_else(|| AppError::invalid(format!("WSL can't open {}.", target.dir)))?;
                args.push("--cd".into());
                args.push(dir);
            }
            args.push("--".into());
            for f in &target.files {
                compose.push("-f".into());
                compose.push(
                    to_wsl_path(f)
                        .ok_or_else(|| AppError::invalid(format!("WSL can't open {f}.")))?,
                );
            }
            compose.extend(verb.iter().map(|s| s.to_string()));
            args.extend(compose);
            Ok(("wsl.exe".into(), args, None))
        }
        Runner::Host => {
            for f in &target.files {
                compose.push("-f".into());
                compose.push(to_host_path(f)?);
            }
            compose.extend(verb.iter().map(|s| s.to_string()));
            let dir = if target.dir.is_empty() {
                None
            } else {
                Some(to_host_path(&target.dir)?)
            };
            let program = compose.remove(0);
            Ok((program, compose, dir))
        }
    }
}

/// Compose's default project name for a folder: its name, lower case, keeping
/// only a-z, 0-9, _ and -.
pub fn default_project_name(dir: &str) -> String {
    let base = dir
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("");
    base.to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

/// The biggest compose file the app will show.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Where this machine can read a project's file from. On Windows, `/mnt/<drive>`
/// is the drive itself and other Linux paths are read through
/// `\\wsl.localhost\<distro>\…`; elsewhere Linux paths are read as they are.
pub fn readable_path(p: &str, distro: Option<&str>, windows: bool) -> Result<String, AppError> {
    let p = p.trim();
    if !windows || !p.starts_with('/') {
        return Ok(p.to_string());
    }
    let on_drive = to_windows_path(p, "");
    if !on_drive.starts_with('/') {
        return Ok(on_drive);
    }
    match distro.filter(|d| !d.is_empty()) {
        Some(d) => Ok(to_windows_path(p, d)),
        None => Err(AppError::invalid(format!(
            "{p} is inside WSL, and there's no WSL distro to read it from. Choose one in Settings."
        ))),
    }
}

/// Whether a path looks like a compose file: the only files the app opens.
pub fn is_compose_file(p: &str) -> bool {
    let lower = p.to_ascii_lowercase();
    lower.ends_with(".yml") || lower.ends_with(".yaml")
}

/// Compose files the user pinned, so the project shows while it's down.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", from = "PinnedSaved")]
pub struct Pinned {
    /// Project name (from `compose config`).
    pub name: String,
    /// As the user chose them (Windows paths), in -f order.
    pub files: Vec<String>,
}

/// A pin as saved: `files`, or `file` from before multi-file pins.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinnedSaved {
    name: String,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    file: Option<String>,
}

impl From<PinnedSaved> for Pinned {
    fn from(s: PinnedSaved) -> Pinned {
        let mut files = s.files;
        if files.is_empty() {
            files.extend(s.file);
        }
        Pinned {
            name: s.name,
            files,
        }
    }
}

/// The parent folder of a file path (either slash).
pub fn parent_dir(file: &str) -> String {
    match file.rfind(['/', '\\']) {
        Some(0) => "/".into(),
        Some(i) => file[..i].to_string(),
        None => String::new(),
    }
}

/// The last part of a path (either slash).
pub fn file_name(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

/// A folder and a name in it, with the folder's own kind of slash.
pub fn join_path(dir: &str, name: &str) -> String {
    let sep = if dir.contains('\\') || (!dir.starts_with('/') && dir.contains(':')) {
        '\\'
    } else {
        '/'
    };
    let dir = dir.trim_end_matches(['/', '\\']);
    if dir.is_empty() && sep == '/' {
        return format!("/{name}");
    }
    format!("{dir}{sep}{name}")
}

/// Compose's own file names, in the order it looks for them.
pub const DEFAULT_FILES: [&str; 4] = [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
];

/// What a compose file is to the others in its folder.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum FileRole {
    /// What `docker compose` reads in that folder by default.
    Base,
    /// `<base>.override.y(a)ml`, which compose layers on the base by default.
    Override,
    /// Anything else named like a compose file (`compose-dev.yml`,
    /// `docker-compose.prod.yaml`, a second default name).
    Variant,
}

/// `compose.yml` -> ("compose", false); `docker-compose.override.yaml` ->
/// ("docker-compose", true); `compose-dev.yml` -> ("compose-dev", false).
/// None for names that aren't compose files.
fn compose_stem(name: &str) -> Option<(String, bool)> {
    let lower = name.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".yml")
        .or_else(|| lower.strip_suffix(".yaml"))?;
    let rest = stem
        .strip_prefix("docker-compose")
        .or_else(|| stem.strip_prefix("compose"))?;
    if !(rest.is_empty() || rest.starts_with('-') || rest.starts_with('.')) {
        return None;
    }
    match stem.strip_suffix(".override") {
        Some(base) if base == "compose" || base == "docker-compose" => {
            Some((base.to_string(), true))
        }
        _ => Some((stem.to_string(), false)),
    }
}

/// Whether a file name is one this app offers from a folder: compose's
/// defaults and their overrides, and `compose-*` / `docker-compose-*` (or `.`)
/// variants, .yml or .yaml.
pub fn is_compose_name(name: &str) -> bool {
    compose_stem(name).is_some()
}

/// One file offered when a compose file or folder is dropped.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub role: FileRole,
    /// Ticked to start with.
    pub ticked: bool,
}

/// The base file compose would pick from these names, if any.
fn base_of<'a>(names: &[&'a str]) -> Option<&'a str> {
    DEFAULT_FILES
        .iter()
        .find_map(|d| names.iter().find(|n| n.eq_ignore_ascii_case(d)).copied())
}

/// The override for a base file among these names: same stem first, then any
/// default override.
fn override_of<'a>(base: &str, names: &[&'a str]) -> Option<&'a str> {
    let (stem, _) = compose_stem(base)?;
    let overrides: Vec<&str> = names
        .iter()
        .copied()
        .filter(|n| matches!(compose_stem(n), Some((_, true))))
        .collect();
    overrides
        .iter()
        .find(|n| compose_stem(n).map(|(s, _)| s) == Some(stem.clone()))
        .or_else(|| overrides.first())
        .copied()
}

/// Puts candidates in -f order: base, override, then variants by name.
fn ordered(mut list: Vec<Candidate>) -> Vec<Candidate> {
    list.sort_by(|a, b| {
        a.role.cmp(&b.role).then_with(|| {
            file_name(&a.path)
                .to_ascii_lowercase()
                .cmp(&file_name(&b.path).to_ascii_lowercase())
        })
    });
    list
}

/// What a dropped folder offers, from the names in it: the base file and its
/// override ticked, variants not. With no base file, a lone candidate is
/// ticked; several are left for the user to choose.
pub fn folder_candidates(dir: &str, names: &[&str]) -> Vec<Candidate> {
    let names: Vec<&str> = names
        .iter()
        .copied()
        .filter(|n| is_compose_name(n))
        .collect();
    let base = base_of(&names);
    let over = base.and_then(|b| override_of(b, &names));
    let lone = names.len() == 1;
    ordered(
        names
            .iter()
            .map(|n| {
                let role = if Some(*n) == base {
                    FileRole::Base
                } else if Some(*n) == over {
                    FileRole::Override
                } else {
                    FileRole::Variant
                };
                Candidate {
                    path: join_path(dir, n),
                    role,
                    ticked: role != FileRole::Variant || lone,
                }
            })
            .collect(),
    )
}

/// What dropped files from one folder offer: each of them, ticked, plus the
/// base file's override from the same folder (ticked; explicit -f files stop
/// compose loading it on its own). `siblings` are the names in the folder.
pub fn file_candidates(dir: &str, dropped: &[&str], siblings: &[&str]) -> Vec<Candidate> {
    let base = base_of(dropped);
    let mut list: Vec<Candidate> = dropped
        .iter()
        .map(|n| Candidate {
            path: join_path(dir, n),
            role: if Some(*n) == base {
                FileRole::Base
            } else if matches!(compose_stem(n), Some((_, true))) {
                FileRole::Override
            } else {
                FileRole::Variant
            },
            ticked: true,
        })
        .collect();
    let has_override = list.iter().any(|c| c.role == FileRole::Override);
    if let (Some(b), false) = (base, has_override) {
        if let Some(o) = override_of(b, siblings) {
            list.push(Candidate {
                path: join_path(dir, o),
                role: FileRole::Override,
                ticked: true,
            });
        }
    }
    ordered(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn picked(list: &[Candidate]) -> Vec<(&str, FileRole, bool)> {
        list.iter()
            .map(|c| (file_name(&c.path), c.role, c.ticked))
            .collect()
    }

    #[test]
    fn knows_compose_file_names() {
        for n in [
            "compose.yaml",
            "compose.yml",
            "docker-compose.yml",
            "Docker-Compose.YAML",
            "compose.override.yml",
            "docker-compose.override.yaml",
            "compose-dev.yml",
            "docker-compose-prod.yaml",
            "docker-compose.ci.yml",
        ] {
            assert!(is_compose_name(n), "{n}");
        }
        for n in [
            "composer.yml",
            "compose.json",
            "app.yml",
            "my-compose.yml",
            ".env",
            "compose",
        ] {
            assert!(!is_compose_name(n), "{n}");
        }
    }

    #[test]
    fn offers_a_folders_files() {
        let names = [
            "README.md",
            "docker-compose-prod.yml",
            "compose.override.yaml",
            "docker-compose.yml",
            "compose-dev.yaml",
            ".env",
        ];
        let list = folder_candidates(r"E:\shop", &names);
        assert_eq!(
            picked(&list),
            vec![
                ("docker-compose.yml", FileRole::Base, true),
                ("compose.override.yaml", FileRole::Override, true),
                ("compose-dev.yaml", FileRole::Variant, false),
                ("docker-compose-prod.yml", FileRole::Variant, false),
            ]
        );
        assert_eq!(list[0].path, r"E:\shop\docker-compose.yml");

        // compose's own order picks the base; the matching override wins.
        let list = folder_candidates(
            "/home/mark/app",
            &[
                "docker-compose.yml",
                "compose.yaml",
                "docker-compose.override.yml",
                "compose.override.yml",
            ],
        );
        assert_eq!(
            picked(&list),
            vec![
                ("compose.yaml", FileRole::Base, true),
                ("compose.override.yml", FileRole::Override, true),
                ("docker-compose.override.yml", FileRole::Variant, false),
                ("docker-compose.yml", FileRole::Variant, false),
            ]
        );
        assert_eq!(list[0].path, "/home/mark/app/compose.yaml");

        // No base: one variant is ticked, several are left to choose.
        assert_eq!(
            picked(&folder_candidates("/x", &["compose-dev.yml"])),
            vec![("compose-dev.yml", FileRole::Variant, true)]
        );
        assert!(
            folder_candidates("/x", &["compose-dev.yml", "compose-prod.yml"])
                .iter()
                .all(|c| !c.ticked)
        );
        assert!(folder_candidates("/x", &["app.yml"]).is_empty());
    }

    #[test]
    fn adds_the_override_to_dropped_files() {
        let siblings = [
            "docker-compose.yml",
            "docker-compose.override.yml",
            "compose-dev.yml",
        ];
        assert_eq!(
            picked(&file_candidates(
                r"E:\shop",
                &["docker-compose.yml"],
                &siblings
            )),
            vec![
                ("docker-compose.yml", FileRole::Base, true),
                ("docker-compose.override.yml", FileRole::Override, true),
            ]
        );
        // Dropped together: in -f order, and the override only once.
        assert_eq!(
            picked(&file_candidates(
                r"E:\shop",
                &[
                    "compose-dev.yml",
                    "docker-compose.override.yml",
                    "docker-compose.yml"
                ],
                &siblings
            )),
            vec![
                ("docker-compose.yml", FileRole::Base, true),
                ("docker-compose.override.yml", FileRole::Override, true),
                ("compose-dev.yml", FileRole::Variant, true),
            ]
        );
        // A variant alone stays alone.
        assert_eq!(
            picked(&file_candidates(
                r"E:\shop",
                &["compose-dev.yml"],
                &siblings
            )),
            vec![("compose-dev.yml", FileRole::Variant, true)]
        );
    }

    #[test]
    fn joins_paths() {
        assert_eq!(join_path(r"E:\shop", "compose.yml"), r"E:\shop\compose.yml");
        assert_eq!(join_path(r"E:\", "compose.yml"), r"E:\compose.yml");
        assert_eq!(join_path("E:", "compose.yml"), r"E:\compose.yml");
        assert_eq!(join_path("/home/x/", "compose.yml"), "/home/x/compose.yml");
        assert_eq!(join_path("/", "compose.yml"), "/compose.yml");
        assert_eq!(
            join_path(r"\\wsl.localhost\Ubuntu-Dev\home", "compose.yml"),
            r"\\wsl.localhost\Ubuntu-Dev\home\compose.yml"
        );
        assert_eq!(file_name(r"E:\shop\compose.yml"), "compose.yml");
        assert_eq!(file_name("/x/y/"), "y");
    }

    #[test]
    fn reads_old_and_new_pins() {
        let old: Pinned =
            serde_json::from_value(json!({"name": "shop", "file": r"E:\shop\compose.yml"}))
                .unwrap();
        assert_eq!(old.files, vec![r"E:\shop\compose.yml".to_string()]);
        let new: Pinned = serde_json::from_value(
            json!({"name": "shop", "files": ["a.yml", "b.yml"], "file": "ignored.yml"}),
        )
        .unwrap();
        assert_eq!(new.files, vec!["a.yml".to_string(), "b.yml".to_string()]);
        assert_eq!(
            serde_json::to_value(&new).unwrap(),
            json!({"name": "shop", "files": ["a.yml", "b.yml"]})
        );
    }

    #[test]
    fn finds_readable_paths() {
        assert_eq!(
            readable_path("/mnt/e/shop/compose.yml", None, true).unwrap(),
            r"E:\shop\compose.yml"
        );
        assert_eq!(
            readable_path("/home/mark/app/compose.yml", Some("Ubuntu-Dev"), true).unwrap(),
            r"\\wsl.localhost\Ubuntu-Dev\home\mark\app\compose.yml"
        );
        assert!(readable_path("/home/mark/app/compose.yml", None, true).is_err());
        assert!(readable_path("/home/mark/app/compose.yml", Some(""), true).is_err());
        assert_eq!(
            readable_path(r"E:\shop\compose.yml", None, true).unwrap(),
            r"E:\shop\compose.yml"
        );
        assert_eq!(
            readable_path("/home/mark/compose.yml", None, false).unwrap(),
            "/home/mark/compose.yml"
        );
    }

    #[test]
    fn only_opens_compose_files() {
        assert!(is_compose_file(r"E:\shop\compose.yml"));
        assert!(is_compose_file("/x/docker-compose.override.YAML"));
        assert!(!is_compose_file(r"E:\shop\run.exe"));
        assert!(!is_compose_file("/x/.env"));
    }

    #[test]
    fn converts_paths_to_wsl() {
        assert_eq!(
            to_wsl_path(r"E:\claude\projects\shop").as_deref(),
            Some("/mnt/e/claude/projects/shop")
        );
        assert_eq!(
            to_wsl_path("c:/Users/me").as_deref(),
            Some("/mnt/c/Users/me")
        );
        assert_eq!(to_wsl_path("D:\\").as_deref(), Some("/mnt/d"));
        assert_eq!(
            to_wsl_path(r"\\wsl$\Ubuntu-Dev\home\mark\app").as_deref(),
            Some("/home/mark/app")
        );
        assert_eq!(
            to_wsl_path(r"\\wsl.localhost\Ubuntu-Dev\home\mark").as_deref(),
            Some("/home/mark")
        );
        assert_eq!(to_wsl_path("/home/mark/x").as_deref(), Some("/home/mark/x"));
        assert_eq!(to_wsl_path(r"\\server\share\x"), None);
    }

    #[test]
    fn converts_paths_to_windows() {
        assert_eq!(
            to_windows_path("/mnt/e/claude/shop", "Ubuntu-Dev"),
            r"E:\claude\shop"
        );
        assert_eq!(
            to_windows_path("/home/mark/app", "Ubuntu-Dev"),
            r"\\wsl.localhost\Ubuntu-Dev\home\mark\app"
        );
        assert_eq!(to_windows_path(r"E:\x", "Ubuntu-Dev"), r"E:\x");
        assert_eq!(to_windows_path("/home/mark", ""), "/home/mark");
    }

    #[test]
    fn decodes_wsl_output() {
        let utf16: Vec<u8> = "  NAME  STATE\r\n* Ubuntu-Dev Running 2\r\n"
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        let text = decode_output(&utf16);
        assert!(text.contains("* Ubuntu-Dev Running 2"));
        assert_eq!(decode_output("plain utf8 ✓".as_bytes()), "plain utf8 ✓");
        let d = parse_distros(&text);
        assert_eq!(
            d,
            vec![Distro {
                name: "Ubuntu-Dev".into(),
                default: true,
                running: true,
                version: 2
            }]
        );
    }

    #[test]
    fn parses_distro_list() {
        let text = "  NAME           STATE           VERSION\r\n* Ubuntu-Dev     Running         2\r\n  Ubuntu         Stopped         2\r\n  Legacy         Stopped         1\r\n";
        let d = parse_distros(text);
        assert_eq!(d.len(), 3);
        assert!(d[0].default && d[0].running);
        assert!(!d[1].default && !d[1].running);
        assert_eq!(d[2].version, 1);
    }

    #[test]
    fn reads_the_runner_from_settings() {
        assert_eq!(
            Runner::from_values(Some(&json!("host")), None),
            Runner::Host
        );
        assert_eq!(
            Runner::from_values(Some(&json!("wsl")), Some(&json!("Ubuntu-Dev"))),
            Runner::Wsl {
                distro: Some("Ubuntu-Dev".into())
            }
        );
        assert_eq!(
            Runner::from_values(Some(&json!("wsl")), Some(&json!(""))),
            Runner::Wsl { distro: None }
        );
    }

    #[test]
    fn builds_wsl_command_lines() {
        let t = Target {
            name: Some("shop".into()),
            dir: r"E:\projects\shop".into(),
            files: vec![r"E:\projects\shop\compose.yml".into()],
        };
        let (prog, args, dir) = command_line(
            &Runner::Wsl {
                distro: Some("Ubuntu-Dev".into()),
            },
            &t,
            "up",
        )
        .unwrap();
        assert_eq!(prog, "wsl.exe");
        assert_eq!(dir, None);
        assert_eq!(
            args,
            vec![
                "-d",
                "Ubuntu-Dev",
                "--cd",
                "/mnt/e/projects/shop",
                "--",
                "docker",
                "compose",
                "-p",
                "shop",
                "-f",
                "/mnt/e/projects/shop/compose.yml",
                "up",
                "-d",
                "--remove-orphans"
            ]
        );
        // A project only known from labels, files gone: just -p.
        let t = Target {
            name: Some("old".into()),
            dir: String::new(),
            files: vec![],
        };
        let (_, args, _) = command_line(&Runner::Wsl { distro: None }, &t, "down-volumes").unwrap();
        assert_eq!(
            args,
            vec!["--", "docker", "compose", "-p", "old", "down", "--volumes"]
        );
    }

    #[test]
    fn builds_host_command_lines() {
        let t = Target {
            name: None,
            dir: "/srv/app".into(),
            files: vec![],
        };
        if cfg!(windows) {
            assert_eq!(
                command_line(&Runner::Host, &t, "up").unwrap_err().kind,
                crate::error::ErrorKind::Invalid
            );
            let t = Target {
                name: None,
                dir: "/mnt/e/app".into(),
                files: vec![],
            };
            let (prog, args, dir) = command_line(&Runner::Host, &t, "pull").unwrap();
            assert_eq!(
                (prog.as_str(), args, dir.as_deref()),
                (
                    "docker",
                    vec!["compose".to_string(), "pull".into()],
                    Some(r"E:\app")
                )
            );
        } else {
            let (prog, args, dir) = command_line(&Runner::Host, &t, "up").unwrap();
            assert_eq!(prog, "docker");
            assert_eq!(args[0], "compose");
            assert_eq!(dir.as_deref(), Some("/srv/app"));
        }
    }

    #[test]
    fn allows_only_known_verbs() {
        assert!(verb_args("up").is_ok());
        assert!(verb_args("exec").is_err());
        assert!(verb_args("up; rm -rf /").is_err());
    }

    #[test]
    fn names_projects_like_compose() {
        assert_eq!(default_project_name(r"E:\Projects\My Shop.v2\"), "myshopv2");
        assert_eq!(
            default_project_name("/home/mark/tracker-app"),
            "tracker-app"
        );
        assert_eq!(parent_dir(r"E:\a\compose.yml"), r"E:\a");
        assert_eq!(parent_dir("/compose.yml"), "/");
    }
}
