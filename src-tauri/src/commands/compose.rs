//! Compose commands: run a verb with streamed output, one-shot runs (config,
//! version), WSL distros, and pinned compose files.

use super::AppState;
use crate::compose::{self, Distro, Pinned, Runner, Target};
use crate::error::AppError;
use serde::Serialize;
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
    if !matches!(verb.as_str(), "version" | "validate" | "config") {
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

fn pinned_list(state: &AppState) -> Vec<Pinned> {
    state
        .settings
        .load()
        .values
        .get(compose::PINNED_KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
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

/// Pins a compose file: compose reads it (so a broken file is refused) and
/// names the project.
#[tauri::command]
pub async fn compose_pin(
    state: State<'_, AppState>,
    file: String,
) -> Result<Vec<Pinned>, AppError> {
    let target = Target {
        name: None,
        dir: compose::parent_dir(&file),
        files: vec![file.clone()],
    };
    let out = run_once(&runner(&state), &target, "config").await?;
    if out.code != Some(0) {
        let msg = out.stderr.trim();
        return Err(AppError::invalid(format!(
            "Compose couldn't read {file}: {}",
            if msg.is_empty() { "no details" } else { msg }
        )));
    }
    let name = serde_json::from_str::<serde_json::Value>(&out.stdout)
        .ok()
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from))
        .unwrap_or_else(|| compose::default_project_name(&target.dir));
    let mut list: Vec<Pinned> = pinned_list(&state)
        .into_iter()
        .filter(|p| p.file != file && p.name != name)
        .collect();
    list.push(Pinned { name, file });
    list.sort_by(|a, b| a.name.cmp(&b.name));
    save_pinned(&state, &list)
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
#[cfg(all(test, feature = "integration", windows))]
mod integration {
    use super::*;
    use crate::engine::{container_item, Engine, LABEL_PROJECT};
    use bollard::query_parameters::ListContainersOptionsBuilder;

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
}
