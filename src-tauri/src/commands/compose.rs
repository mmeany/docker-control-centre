//! Compose commands: run a verb with streamed output, one-shot runs (config,
//! version), WSL distros, and pinned compose files.

use super::AppState;
use crate::compose::{self, Candidate, Distro, Pinned, Runner, Target};
use crate::engine::map_error;
use crate::error::{AppError, ErrorKind};
use crate::volume_audit::{self, ImageVolumes, LiveMount, ProjectSpec, UnnamedVolumes};
use bollard::query_parameters::ListContainersOptionsBuilder;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::process::Stdio;
use tauri::ipc::Channel;
use tauri::{Manager, State, Window};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ComposeMessage {
    Line {
        text: String,
        err: bool,
    },
    Exit {
        code: Option<i32>,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn runner(state: &AppState) -> Runner {
    let s = state.settings.load();
    Runner::from_values(
        s.values.get(compose::MODE_KEY),
        s.values.get(compose::DISTRO_KEY),
    )
}

fn command(program: &str, args: &[String], dir: Option<&str>) -> Command {
    let mut c = Command::new(program);
    c.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(d) = dir {
        c.current_dir(d);
    }
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    c
}

fn spawn_error(program: &str, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::new(
            crate::error::ErrorKind::NotFound,
            format!("{program} isn't installed or isn't on the PATH."),
        )
    } else {
        AppError::from(format!("Couldn't start {program}: {e}"))
    }
}

/// Runs a compose verb to completion and returns everything it printed.
pub async fn run_once(runner: &Runner, target: &Target, verb: &str) -> Result<Output, AppError> {
    let (program, args, dir) = compose::command_line(runner, target, verb)?;
    let out = command(&program, &args, dir.as_deref())
        .output()
        .await
        .map_err(|e| spawn_error(&program, e))?;
    Ok(Output {
        code: out.status.code(),
        stdout: compose::decode_output(&out.stdout),
        stderr: compose::decode_output(&out.stderr),
    })
}

/// Forwards a pipe line by line. If it turns out to be UTF-16 (wsl.exe's own
/// messages), it's gathered and decoded at the end instead.
async fn pump(mut pipe: impl AsyncRead + Unpin, err: bool, ch: Channel<ComposeMessage>) {
    let mut buf = [0u8; 4096];
    let mut pending: Vec<u8> = vec![];
    let mut utf16: Option<bool> = None;
    loop {
        let n = match pipe.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        pending.extend_from_slice(&buf[..n]);
        let wide = *utf16.get_or_insert_with(|| {
            compose::decode_output(&pending) != String::from_utf8_lossy(&pending)
        });
        if wide {
            continue;
        }
        while let Some(i) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=i).collect();
            let text = crate::streams::strip_ansi(String::from_utf8_lossy(&line).trim_end());
            if ch.send(ComposeMessage::Line { text, err }).is_err() {
                return;
            }
        }
    }
    if !pending.is_empty() {
        for line in compose::decode_output(&pending).lines() {
            let _ = ch.send(ComposeMessage::Line {
                text: crate::streams::strip_ansi(line.trim_end()),
                err,
            });
        }
    }
}

/// Runs `docker compose <verb>` for a project, streaming its output.
#[tauri::command]
pub fn compose_run(
    window: Window,
    state: State<'_, AppState>,
    target: Target,
    verb: String,
    on_message: Channel<ComposeMessage>,
) -> Result<u64, AppError> {
    let (program, args, dir) = compose::command_line(&runner(&state), &target, &verb)?;
    let mut child = command(&program, &args, dir.as_deref())
        .spawn()
        .map_err(|e| spawn_error(&program, e))?;
    let _ = on_message.send(ComposeMessage::Line {
        text: format!("> {program} {}", args.join(" ")),
        err: false,
    });
    let id = state.streams.next_id();
    let app = window.app_handle().clone();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let task = tauri::async_runtime::spawn(async move {
        let a = stdout.map(|p| tauri::async_runtime::spawn(pump(p, false, on_message.clone())));
        let b = stderr.map(|p| tauri::async_runtime::spawn(pump(p, true, on_message.clone())));
        let status = child.wait().await;
        for t in [a, b].into_iter().flatten() {
            let _ = t.await;
        }
        let msg = match status {
            Ok(s) => ComposeMessage::Exit {
                code: s.code(),
                error: None,
            },
            Err(e) => ComposeMessage::Exit {
                code: None,
                error: Some(e.to_string()),
            },
        };
        let _ = on_message.send(msg);
        app.state::<AppState>().streams.done(id);
    });
    state.streams.add(id, window.label(), task);
    Ok(id)
}

/// Runs a quick verb (version, validate) and returns its output.
#[tauri::command]
pub async fn compose_check(
    state: State<'_, AppState>,
    target: Option<Target>,
    verb: String,
) -> Result<Output, AppError> {
    if !matches!(
        verb.as_str(),
        "version" | "validate" | "config" | "config-yaml"
    ) {
        return Err(AppError::invalid(
            "Only version, validate and config run this way.",
        ));
    }
    run_once(&runner(&state), &target.unwrap_or_default(), &verb).await
}

/// WSL distros on this machine (empty when there's no WSL).
#[tauri::command]
pub async fn wsl_distros() -> Result<Vec<Distro>, AppError> {
    if !cfg!(windows) {
        return Ok(vec![]);
    }
    let out = command("wsl.exe", &["-l".into(), "-v".into()], None)
        .output()
        .await
        .map_err(|e| spawn_error("wsl.exe", e))?;
    Ok(compose::parse_distros(&compose::decode_output(&out.stdout)))
}

/// The distro WSL paths are read from: the one in Settings, else WSL's default.
async fn read_distro(state: &AppState) -> Option<String> {
    let chosen = state
        .settings
        .load()
        .values
        .get(compose::DISTRO_KEY)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    if chosen.is_some() {
        return chosen;
    }
    wsl_distros()
        .await
        .ok()?
        .into_iter()
        .find(|d| d.default)
        .map(|d| d.name)
}

async fn local_path(state: &AppState, path: &str) -> Result<String, AppError> {
    let distro = if cfg!(windows) && path.trim().starts_with('/') {
        read_distro(state).await
    } else {
        None
    };
    compose::readable_path(path, distro.as_deref(), cfg!(windows))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeFile {
    /// Where it was read from (a Windows path on Windows).
    pub path: String,
    pub text: String,
    pub size: u64,
}

/// Reads a project's compose file (engine-side or Windows path) to show it.
#[tauri::command]
pub async fn compose_read_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<ComposeFile, AppError> {
    let local = local_path(&state, &path).await?;
    let meta = tokio::fs::metadata(&local)
        .await
        .map_err(|e| AppError::io(e, &local))?;
    if !meta.is_file() {
        return Err(AppError::invalid(format!("{local} isn't a file.")));
    }
    if meta.len() > compose::MAX_FILE_BYTES {
        return Err(AppError::invalid(format!(
            "{local} is {} KB; files over {} KB aren't shown.",
            meta.len() / 1024,
            compose::MAX_FILE_BYTES / 1024
        )));
    }
    let bytes = tokio::fs::read(&local)
        .await
        .map_err(|e| AppError::io(e, &local))?;
    Ok(ComposeFile {
        path: local,
        size: bytes.len() as u64,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Shows a compose file in the file manager (`folder`) or opens it in its
/// default app (`open`). Only .yml / .yaml files that exist.
#[tauri::command]
pub async fn compose_show_file(
    state: State<'_, AppState>,
    path: String,
    how: String,
) -> Result<(), AppError> {
    let local = local_path(&state, &path).await?;
    if !compose::is_compose_file(&local) {
        return Err(AppError::invalid(format!("{local} isn't a compose file.")));
    }
    let meta = tokio::fs::metadata(&local)
        .await
        .map_err(|e| AppError::io(e, &local))?;
    if !meta.is_file() {
        return Err(AppError::invalid(format!("{local} isn't a file.")));
    }
    let folder = match how.as_str() {
        "folder" => true,
        "open" => false,
        _ => return Err(AppError::invalid("Show the folder or open the file.")),
    };
    super::os_open(&local, folder)
}

/// Pinned files from settings; an entry that can't be read is skipped, so
/// it can't take the rest with it when the list is next saved.
fn pinned_list(state: &AppState) -> Vec<Pinned> {
    compose::read_pins(state.settings.load().values.get(compose::PINNED_KEY))
}

/// The distro compose runs in when it runs in WSL (the chosen one, else
/// WSL's default); None on the host.
async fn wsl_runs_in(state: &AppState) -> Option<String> {
    match runner(state) {
        Runner::Wsl { .. } => read_distro(state).await,
        Runner::Host => None,
    }
}

fn save_pinned(state: &AppState, list: &[Pinned]) -> Result<Vec<Pinned>, AppError> {
    let v = serde_json::to_value(list).map_err(|e| AppError::from(e.to_string()))?;
    state.settings.update(|s| {
        s.values.insert(compose::PINNED_KEY.into(), v);
    })?;
    Ok(list.to_vec())
}

#[tauri::command]
pub fn compose_pinned(state: State<'_, AppState>) -> Vec<Pinned> {
    pinned_list(&state)
}

/// Compose reads the files (so broken ones are refused) and names the project.
/// The resolved config can hold secrets: only the name leaves this function.
async fn project_name(state: &AppState, files: &[String]) -> Result<String, AppError> {
    let first = files
        .first()
        .ok_or_else(|| AppError::invalid("Choose at least one compose file."))?;
    let runs_in = wsl_runs_in(state).await;
    for f in files {
        compose::check_distro(f, runs_in.as_deref())?;
    }
    let target = Target {
        name: None,
        dir: compose::parent_dir(first),
        files: files.to_vec(),
    };
    let out = run_once(&runner(state), &target, "config").await?;
    if out.code != Some(0) {
        let msg = out.stderr.trim();
        let what = if files.len() == 1 {
            first.clone()
        } else {
            format!("these {} files", files.len())
        };
        return Err(AppError::invalid(format!(
            "Compose couldn't read {what}: {}",
            if msg.is_empty() { "no details" } else { msg }
        )));
    }
    Ok(serde_json::from_str::<serde_json::Value>(&out.stdout)
        .ok()
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from))
        .unwrap_or_else(|| compose::default_project_name(&target.dir)))
}

/// The project name compose gives these files (in -f order), checking they read.
#[tauri::command]
pub async fn compose_project_name(
    state: State<'_, AppState>,
    files: Vec<String>,
) -> Result<String, AppError> {
    project_name(&state, &files).await
}

/// Pins compose files (one project, in -f order): compose reads them (so
/// broken ones are refused) and names the project. Replaces a pin with the
/// same name or the same files.
#[tauri::command]
pub async fn compose_pin(
    state: State<'_, AppState>,
    files: Vec<String>,
) -> Result<Vec<Pinned>, AppError> {
    let name = project_name(&state, &files).await?;
    let mut list: Vec<Pinned> = pinned_list(&state)
        .into_iter()
        .filter(|p| p.files != files && p.name != name)
        .collect();
    list.push(Pinned { name, files });
    list.sort_by(|a, b| a.name.cmp(&b.name));
    save_pinned(&state, &list)
}

/// What one folder's worth of a drop offers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropGroup {
    pub dir: String,
    pub candidates: Vec<Candidate>,
    /// Why nothing from here can run.
    pub error: Option<String>,
}

/// The names of the files (not folders) in a folder.
async fn file_names(dir: &str) -> Result<Vec<String>, AppError> {
    let mut rd = tokio::fs::read_dir(dir)
        .await
        .map_err(|e| AppError::io(e, dir))?;
    let mut out = vec![];
    while let Some(e) = rd.next_entry().await.map_err(|e| AppError::io(e, dir))? {
        // metadata follows links, so a linked compose file counts.
        if tokio::fs::metadata(e.path())
            .await
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            out.push(e.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(out)
}

/// Files and folders dropped on the window (from Explorer), as compose
/// projects to confirm: a folder offers its compose files, dropped files are
/// grouped by folder (with the base file's override added). Nothing runs here.
#[tauri::command]
pub async fn compose_drop_candidates(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<DropGroup>, AppError> {
    let wsl = matches!(runner(&state), Runner::Wsl { .. });
    let mut groups: Vec<DropGroup> = vec![];
    let mut dropped_files: Vec<(String, Vec<String>)> = vec![];
    let group_error = |dir: &str, error: String| DropGroup {
        dir: dir.to_string(),
        candidates: vec![],
        error: Some(error),
    };
    for p in paths {
        let meta = match tokio::fs::metadata(&p).await {
            Ok(m) => m,
            Err(e) => {
                groups.push(group_error(&p, AppError::io(e, &p).message));
                continue;
            }
        };
        if meta.is_dir() {
            match file_names(&p).await {
                Ok(names) => {
                    let names: Vec<&str> = names.iter().map(String::as_str).collect();
                    let candidates = compose::folder_candidates(&p, &names);
                    groups.push(if candidates.is_empty() {
                        group_error(
                            &p,
                            format!("{p} has no compose file (compose.yaml, docker-compose.yml, compose-*.yml and so on)."),
                        )
                    } else {
                        DropGroup {
                            dir: p.clone(),
                            candidates,
                            error: None,
                        }
                    });
                }
                Err(e) => groups.push(group_error(&p, e.message)),
            }
        } else if compose::is_compose_file(&p) {
            let dir = compose::parent_dir(&p);
            let name = compose::file_name(&p).to_string();
            match dropped_files.iter_mut().find(|(d, _)| *d == dir) {
                Some((_, names)) => names.push(name),
                None => dropped_files.push((dir, vec![name])),
            }
        }
    }
    for (dir, names) in dropped_files {
        let siblings = file_names(&dir).await.unwrap_or_default();
        let siblings: Vec<&str> = siblings.iter().map(String::as_str).collect();
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        groups.push(DropGroup {
            candidates: compose::file_candidates(&dir, &names, &siblings),
            dir,
            error: None,
        });
    }
    if wsl {
        let runs_in = wsl_runs_in(&state).await;
        for g in groups.iter_mut().filter(|g| g.error.is_none()) {
            let error = if compose::to_wsl_path(&g.dir).is_none() {
                Some(format!(
                    "WSL can't open {}. Compose runs in WSL (Settings), which reaches local drives and WSL folders, not network shares.",
                    g.dir
                ))
            } else {
                compose::check_distro(&g.dir, runs_in.as_deref())
                    .err()
                    .map(|e| e.message)
            };
            if error.is_some() {
                g.error = error;
                g.candidates.clear();
            }
        }
    }
    if groups.is_empty() {
        return Err(AppError::invalid(
            "Drop a compose file (.yml or .yaml), or a folder with one.",
        ));
    }
    Ok(groups)
}

#[tauri::command]
pub fn compose_unpin(state: State<'_, AppState>, name: String) -> Result<Vec<Pinned>, AppError> {
    let list: Vec<Pinned> = pinned_list(&state)
        .into_iter()
        .filter(|p| p.name != name)
        .collect();
    save_pinned(&state, &list)
}

/// Writes text the UI already has (merged logs) to a file.
#[tauri::command]
pub async fn save_text_file(path: String, text: String) -> Result<(), AppError> {
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| AppError::io(e, &path))
}

/// Against a real engine through WSL (`cargo test --features integration`):
/// a project in a Windows temp folder with a bind mount comes up with the
/// mount resolved on the Linux side, then goes down again.
/// The project's unnamed volumes: what compose's config and the images say,
/// plus what its containers hold now. The resolved config can hold secrets:
/// only services, images and volume targets are read from it.
#[tauri::command]
pub async fn compose_unnamed_volumes(
    state: State<'_, AppState>,
    target: Target,
) -> Result<UnnamedVolumes, AppError> {
    let docker = state.engine.docker()?;
    let endpoint = state.engine.endpoint.display();

    let (spec, config_error) = match read_spec(&state, &target).await {
        Ok(s) => (Some(s), None),
        Err(e) => (None, Some(e.message)),
    };
    let project = spec
        .as_ref()
        .and_then(|s| s.name.clone())
        .or_else(|| target.name.clone().filter(|n| !n.is_empty()))
        .unwrap_or_else(|| compose::default_project_name(&target.dir));

    let label = format!("{}={project}", crate::engine::LABEL_PROJECT);
    let filters = HashMap::from([("label", vec![label.as_str()])]);
    let opts = ListContainersOptionsBuilder::new()
        .all(true)
        .filters(&filters)
        .build();
    let list = docker
        .list_containers(Some(opts))
        .await
        .map_err(|x| map_error(endpoint, x))?;
    let mut live = vec![];
    // The image each service runs: a container's exact image first.
    let mut image_of: BTreeMap<String, String> = BTreeMap::new();
    for c in list.into_iter().map(crate::engine::container_item) {
        let Some(service) = c.service.clone() else {
            continue;
        };
        image_of
            .entry(service.clone())
            .or_insert(c.image_id.clone());
        for m in c.volume_mounts {
            if volume_audit::is_anonymous_name(&m.name) {
                live.push(LiveMount {
                    container: c.name.clone(),
                    service: service.clone(),
                    volume: m.name,
                    destination: m.destination,
                });
            }
        }
    }
    for s in spec.iter().flat_map(|p| &p.services) {
        image_of.entry(s.name.clone()).or_insert(s.image.clone());
    }
    let mut images = BTreeMap::new();
    for (service, image) in image_of {
        let v = match docker.inspect_image(&image).await {
            Ok(i) => ImageVolumes::Known(i.config.and_then(|c| c.volumes).unwrap_or_default()),
            Err(e) => {
                let e = map_error(endpoint, e);
                if e.kind != ErrorKind::NotFound {
                    return Err(e);
                }
                ImageVolumes::NotLocal
            }
        };
        images.insert(service, v);
    }
    let (findings, unchecked) = volume_audit::find(&project, spec.as_ref(), &images, &live);
    Ok(UnnamedVolumes {
        project,
        findings,
        unchecked,
        config_error,
    })
}

/// Compose's resolved config for a target, reduced to what the audit needs.
async fn read_spec(state: &AppState, target: &Target) -> Result<ProjectSpec, AppError> {
    if target.files.is_empty() && target.dir.is_empty() {
        return Err(AppError::invalid("There are no compose files to read."));
    }
    let runs_in = wsl_runs_in(state).await;
    for f in &target.files {
        compose::check_distro(f, runs_in.as_deref())?;
    }
    let out = run_once(&runner(state), target, "config").await?;
    if out.code != Some(0) {
        let msg = out.stderr.trim();
        return Err(AppError::invalid(format!(
            "Compose couldn't read the files: {}",
            if msg.is_empty() { "no details" } else { msg }
        )));
    }
    let v: serde_json::Value = serde_json::from_str(&out.stdout)
        .map_err(|e| AppError::from(format!("Compose's config wasn't JSON: {e}")))?;
    Ok(volume_audit::parse_config(
        &v,
        target.name.as_deref().unwrap_or_default(),
    ))
}

#[cfg(all(test, feature = "integration", windows))]
mod integration {
    use super::*;
    use crate::engine::{container_item, Engine, LABEL_PROJECT};
    use bollard::query_parameters::ListContainersOptionsBuilder;

    /// A compose file inside WSL reads through \\wsl.localhost, and the
    /// resolved config fills in a variable from .env.
    #[tokio::test]
    async fn reads_a_file_inside_wsl() {
        let distro = wsl_distros()
            .await
            .expect("distros")
            .into_iter()
            .find(|d| d.default)
            .expect("a default WSL distro")
            .name;
        let dir = format!("/tmp/dcc-read-{}", std::process::id());
        let script = format!(
            "mkdir -p {dir} && printf 'services:\\n  app:\\n    image: busybox\\n    environment:\\n      GREETING: ${{GREETING}}\\n' > {dir}/compose.yml && printf 'GREETING=hello-from-env\\n' > {dir}/.env"
        );
        let made = command(
            "wsl.exe",
            &[
                "-d".into(),
                distro.clone(),
                // --exec: no login shell in between to expand ${GREETING}.
                "--exec".into(),
                "sh".into(),
                "-c".into(),
                script,
            ],
            None,
        )
        .output()
        .await
        .expect("wsl");
        assert!(made.status.success(), "{made:?}");

        let file = format!("{dir}/compose.yml");
        let local = compose::readable_path(&file, Some(&distro), true).unwrap();
        assert!(local.starts_with(r"\\wsl.localhost\"), "{local}");
        let text = tokio::fs::read_to_string(&local)
            .await
            .expect("read through wsl.localhost");
        assert!(text.contains("${GREETING}"), "{text}");

        let runner = Runner::Wsl {
            distro: Some(distro.clone()),
        };
        let target = Target {
            name: Some("dcc-read".into()),
            dir: dir.clone(),
            files: vec![file],
        };
        let out = run_once(&runner, &target, "config-yaml")
            .await
            .expect("config");
        assert_eq!(out.code, Some(0), "{out:?}");
        assert!(out.stdout.contains("hello-from-env"), "{}", out.stdout);

        let _ = command(
            "wsl.exe",
            &[
                "-d".into(),
                distro,
                "--".into(),
                "rm".into(),
                "-rf".into(),
                dir,
            ],
            None,
        )
        .output()
        .await;
    }

    #[tokio::test]
    async fn up_and_down_through_wsl() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        if docker.inspect_image("python:3.12-slim").await.is_err() {
            eprintln!("skipped: python:3.12-slim isn't on this engine");
            return;
        }
        let name = format!("dcc-compose-{}", std::process::id());
        let dir = std::env::temp_dir().join(&name);
        std::fs::create_dir_all(dir.join("data")).unwrap();
        std::fs::write(dir.join("data").join("hello.txt"), "hi").unwrap();
        let file = dir.join("compose.yml");
        std::fs::write(&file, "services:\n  app:\n    image: python:3.12-slim\n    command: [\"sleep\", \"300\"]\n    volumes:\n      - ./data:/data\n").unwrap();
        let runner = Runner::Wsl { distro: None };
        let dir_s = dir.to_string_lossy().to_string();
        let target = Target {
            name: None,
            dir: dir_s.clone(),
            files: vec![file.to_string_lossy().to_string()],
        };

        let version = run_once(&runner, &Target::default(), "version")
            .await
            .expect("version");
        assert_eq!(version.code, Some(0), "{version:?}");

        let config = run_once(&runner, &target, "config").await.expect("config");
        assert_eq!(config.code, Some(0), "{config:?}");
        let project: serde_json::Value = serde_json::from_str(&config.stdout).expect("json");
        let project = project["name"].as_str().unwrap().to_string();
        assert_eq!(project, compose::default_project_name(&dir_s));

        let named = Target {
            name: Some(project.clone()),
            ..target.clone()
        };
        let up = run_once(&runner, &named, "up").await.expect("up");
        assert_eq!(up.code, Some(0), "{up:?}");

        let opts = ListContainersOptionsBuilder::new().all(true).build();
        let mine: Vec<_> = docker
            .list_containers(Some(opts))
            .await
            .unwrap()
            .into_iter()
            .map(container_item)
            .filter(|c| c.project.as_deref() == Some(&project))
            .collect();
        assert_eq!(mine.len(), 1, "{mine:?}");
        let inspect = docker.inspect_container(&mine[0].id, None).await.unwrap();
        let source = inspect.mounts.unwrap()[0].source.clone().unwrap();
        assert!(
            source.starts_with("/mnt/c/"),
            "bind mount resolved as {source}"
        );
        assert_eq!(
            mine[0]
                .working_dir
                .as_deref()
                .map(|d| d.starts_with("/mnt/c/")),
            Some(true)
        );
        assert!(inspect
            .config
            .unwrap()
            .labels
            .unwrap()
            .contains_key(LABEL_PROJECT));

        let down = run_once(&runner, &named, "down").await.expect("down");
        assert_eq!(down.code, Some(0), "{down:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A dropped Windows folder with a base file, its override and a variant:
    /// the base and override are offered ticked, and up through WSL applies
    /// both (the override's variable reaches the container).
    #[tokio::test]
    async fn up_from_a_dropped_folder() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        if docker.inspect_image("python:3.12-slim").await.is_err() {
            eprintln!("skipped: python:3.12-slim isn't on this engine");
            return;
        }
        let name = format!("dcc-drop-{}", std::process::id());
        let dir = std::env::temp_dir().join(&name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("docker-compose.yml"),
            "services:\n  app:\n    image: python:3.12-slim\n    command: [\"sleep\", \"300\"]\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("docker-compose.override.yml"),
            "services:\n  app:\n    environment:\n      FROM_OVERRIDE: \"yes\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("docker-compose-broken.yml"), "not: [compose").unwrap();
        let dir_s = dir.to_string_lossy().to_string();

        let names = file_names(&dir_s).await.expect("list");
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        let offered = compose::folder_candidates(&dir_s, &names);
        let files: Vec<String> = offered
            .iter()
            .filter(|c| c.ticked)
            .map(|c| c.path.clone())
            .collect();
        assert_eq!(files.len(), 2, "{offered:?}");
        assert!(
            files[1].ends_with("docker-compose.override.yml"),
            "{files:?}"
        );

        let runner = Runner::Wsl { distro: None };
        let target = Target {
            name: Some(compose::default_project_name(&dir_s)),
            dir: dir_s.clone(),
            files,
        };
        let up = run_once(&runner, &target, "up").await.expect("up");
        assert_eq!(up.code, Some(0), "{up:?}");

        let opts = ListContainersOptionsBuilder::new().all(true).build();
        let mine: Vec<_> = docker
            .list_containers(Some(opts))
            .await
            .unwrap()
            .into_iter()
            .map(container_item)
            .filter(|c| c.project == target.name)
            .collect();
        assert_eq!(mine.len(), 1, "{mine:?}");
        let env = docker
            .inspect_container(&mine[0].id, None)
            .await
            .unwrap()
            .config
            .unwrap()
            .env
            .unwrap_or_default();
        assert!(env.iter().any(|e| e == "FROM_OVERRIDE=yes"), "{env:?}");

        let down = run_once(&runner, &target, "down").await.expect("down");
        assert_eq!(down.code, Some(0), "{down:?}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
