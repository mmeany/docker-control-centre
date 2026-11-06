//! Streams the UI watches: logs, stats and terminals. Each start command
//! returns an id for `stop_stream`; closing a window stops what it started.

use super::AppState;
use crate::engine::map_error;
use crate::error::AppError;
use crate::streams::{
    self, LineSplitter, LogLine, LogMessage, LogQuery, StatsSample, TermMessage, Utf8Carry,
};
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::query_parameters::{LogsOptions, LogsOptionsBuilder, StatsOptionsBuilder};
use bollard::Docker;
use futures_util::{Stream, StreamExt};
use std::pin::Pin;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State, Window};
use tokio::io::{AsyncWrite, AsyncWriteExt};

/// An open terminal: where to send keystrokes, and its exec for resizing.
pub struct Terminal {
    exec_id: String,
    window: String,
    input: Pin<Box<dyn AsyncWrite + Send>>,
}

fn to_i32(t: Option<i64>) -> Option<i32> {
    t.map(|v| v.clamp(0, i32::MAX as i64) as i32)
}

fn logs_options(q: &LogQuery) -> LogsOptions {
    let mut b = LogsOptionsBuilder::new()
        .stdout(true)
        .stderr(true)
        .timestamps(true)
        .follow(q.follow);
    if let Some(n) = q.tail {
        b = b.tail(&n.to_string());
    }
    if let Some(s) = to_i32(q.since) {
        b = b.since(s);
    }
    if let Some(u) = to_i32(q.until) {
        b = b.until(u);
    }
    b.build()
}

fn push_frame(split: &mut LineSplitter, frame: LogOutput, out: &mut Vec<LogLine>) {
    let (err, bytes) = match frame {
        LogOutput::StdErr { message } => (true, message),
        LogOutput::StdOut { message } | LogOutput::Console { message } => (false, message),
        LogOutput::StdIn { .. } => return,
    };
    split.push(err, &String::from_utf8_lossy(&bytes), out);
}

/// Most lines sent in one message, and how long to gather a burst.
const BATCH_LINES: usize = 2000;
const BATCH_WAIT: Duration = Duration::from_millis(40);

#[tauri::command]
pub fn stream_logs(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    query: LogQuery,
    on_message: Channel<LogMessage>,
) -> Result<u64, AppError> {
    let docker = state.engine.docker()?.clone();
    let endpoint = state.engine.endpoint.display().to_string();
    let stream_id = state.streams.next_id();
    let app = window.app_handle().clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut logs = Box::pin(docker.logs(&id, Some(logs_options(&query))));
        let mut split = LineSplitter::default();
        let error = loop {
            // Wait for something, then gather whatever follows quickly.
            let mut lines = vec![];
            let mut end = None;
            match logs.next().await {
                Some(Ok(f)) => push_frame(&mut split, f, &mut lines),
                Some(Err(e)) => end = Some(Some(map_error(&endpoint, e).message)),
                None => end = Some(None),
            }
            if end.is_none() {
                let deadline = tokio::time::Instant::now() + BATCH_WAIT;
                while lines.len() < BATCH_LINES {
                    match tokio::time::timeout_at(deadline, logs.next()).await {
                        Ok(Some(Ok(f))) => push_frame(&mut split, f, &mut lines),
                        Ok(Some(Err(e))) => {
                            end = Some(Some(map_error(&endpoint, e).message));
                            break;
                        }
                        Ok(None) => {
                            end = Some(None);
                            break;
                        }
                        Err(_) => break,
                    }
                }
            }
            if end.is_some() {
                split.finish(&mut lines);
            }
            if !lines.is_empty() && on_message.send(LogMessage::Lines { lines }).is_err() {
                break None;
            }
            if let Some(e) = end {
                break Some(e);
            }
        };
        if let Some(error) = error {
            let _ = on_message.send(LogMessage::End { error });
        }
        tauri::Manager::state::<AppState>(&app)
            .streams
            .done(stream_id);
    });
    state.streams.add(stream_id, window.label(), task);
    Ok(stream_id)
}

#[tauri::command]
pub fn stop_stream(state: State<'_, AppState>, stream: u64) {
    state.streams.stop(stream);
}

/// Writes a container's logs for a range straight to a file.
#[tauri::command]
pub async fn export_logs(
    state: State<'_, AppState>,
    id: String,
    query: LogQuery,
    timestamps: bool,
    path: String,
) -> Result<usize, AppError> {
    let e = &state.engine;
    let q = LogQuery {
        follow: false,
        ..query
    };
    let mut logs = Box::pin(e.docker()?.logs(&id, Some(logs_options(&q))));
    let mut split = LineSplitter::default();
    let mut lines = vec![];
    while let Some(f) = logs.next().await {
        push_frame(&mut split, f.map_err(|x| e.error(x))?, &mut lines);
    }
    split.finish(&mut lines);
    let mut text = String::new();
    for l in &lines {
        if timestamps && !l.time.is_empty() {
            text.push_str(&l.time);
            text.push(' ');
        }
        text.push_str(&l.text);
        text.push('\n');
    }
    tokio::fs::write(&path, text)
        .await
        .map_err(|x| AppError::io(x, &path))?;
    Ok(lines.len())
}

// ---------------------------------------------------------------------------
// Terminal

/// Runs bash if the image has it, else sh.
const SHELL: &str = "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi";

#[tauri::command]
pub async fn terminal_open(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    on_message: Channel<TermMessage>,
) -> Result<u64, AppError> {
    let e = &state.engine;
    let docker = e.docker()?.clone();
    let opts = CreateExecOptions::<String> {
        attach_stdin: Some(true),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        tty: Some(true),
        env: Some(vec!["TERM=xterm-256color".into()]),
        cmd: Some(vec!["/bin/sh".into(), "-c".into(), SHELL.into()]),
        ..Default::default()
    };
    let exec_id = docker
        .create_exec(&id, opts)
        .await
        .map_err(|x| e.error(x))?
        .id;
    let started = docker
        .start_exec(
            &exec_id,
            Some(StartExecOptions {
                detach: false,
                tty: true,
                output_capacity: None,
            }),
        )
        .await
        .map_err(|x| e.error(x))?;
    let StartExecResults::Attached { output, input } = started else {
        return Err(AppError::from(
            "The engine didn't attach to the shell.".to_string(),
        ));
    };
    let _ = docker
        .resize_exec(
            &exec_id,
            ResizeExecOptions {
                height: rows,
                width: cols,
            },
        )
        .await;

    let session = state.streams.next_id();
    state.terminals.lock().await.insert(
        session,
        Terminal {
            exec_id: exec_id.clone(),
            window: window.label().into(),
            input,
        },
    );
    let app = window.app_handle().clone();
    let task = tauri::async_runtime::spawn(pump_terminal(
        docker, exec_id, output, on_message, app, session,
    ));
    state.streams.add(session, window.label(), task);
    Ok(session)
}

type Output = Pin<Box<dyn Stream<Item = Result<LogOutput, bollard::errors::Error>> + Send>>;

async fn pump_terminal(
    docker: Docker,
    exec_id: String,
    mut output: Output,
    on_message: Channel<TermMessage>,
    app: tauri::AppHandle,
    session: u64,
) {
    let mut carry = Utf8Carry::default();
    let mut message = None;
    while let Some(item) = output.next().await {
        match item {
            Ok(frame) => {
                let data = carry.push(&frame.into_bytes());
                if !data.is_empty() && on_message.send(TermMessage::Output { data }).is_err() {
                    break;
                }
            }
            Err(e) => {
                message = Some(e.to_string());
                break;
            }
        }
    }
    let code = docker
        .inspect_exec(&exec_id)
        .await
        .ok()
        .and_then(|i| i.exit_code);
    // 126 / 127: the shell itself couldn't run (distroless or scratch image).
    if message.is_none() && matches!(code, Some(126) | Some(127)) {
        message = Some("This container has no shell to open.".into());
    }
    let _ = on_message.send(TermMessage::Exit { code, message });
    let state = tauri::Manager::state::<AppState>(&app);
    state.terminals.lock().await.remove(&session);
    state.streams.done(session);
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, AppState>,
    session: u64,
    data: String,
) -> Result<(), AppError> {
    let mut terms = state.terminals.lock().await;
    let t = terms
        .get_mut(&session)
        .ok_or_else(|| AppError::invalid("That terminal has closed."))?;
    t.input
        .write_all(data.as_bytes())
        .await
        .map_err(|x| AppError::io(x, "the terminal"))?;
    t.input
        .flush()
        .await
        .map_err(|x| AppError::io(x, "the terminal"))
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    session: u64,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let exec_id = match state.terminals.lock().await.get(&session) {
        Some(t) => t.exec_id.clone(),
        None => return Ok(()),
    };
    let e = &state.engine;
    e.docker()?
        .resize_exec(
            &exec_id,
            ResizeExecOptions {
                height: rows,
                width: cols,
            },
        )
        .await
        .map_err(|x| e.error(x))
}

/// Ends the shell (closing its input) and stops forwarding output.
#[tauri::command]
pub async fn terminal_close(state: State<'_, AppState>, session: u64) -> Result<(), AppError> {
    if let Some(mut t) = state.terminals.lock().await.remove(&session) {
        let _ = t.input.shutdown().await;
    }
    state.streams.stop(session);
    Ok(())
}

/// Closes every terminal a window opened (it's going away).
pub async fn close_window_terminals(state: &AppState, window: &str) {
    let mut terms = state.terminals.lock().await;
    let ids: Vec<u64> = terms
        .iter()
        .filter(|(_, t)| t.window == window)
        .map(|(id, _)| *id)
        .collect();
    for id in ids {
        if let Some(mut t) = terms.remove(&id) {
            let _ = t.input.shutdown().await;
        }
    }
}

// ---------------------------------------------------------------------------
// Stats

#[tauri::command]
pub fn stream_stats(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    on_message: Channel<StatsSample>,
) -> Result<u64, AppError> {
    let docker = state.engine.docker()?.clone();
    let stream_id = state.streams.next_id();
    let app = window.app_handle().clone();
    let task = tauri::async_runtime::spawn(async move {
        let opts = StatsOptionsBuilder::new()
            .stream(true)
            .one_shot(false)
            .build();
        let mut stats = Box::pin(docker.stats(&id, Some(opts)));
        while let Some(Ok(s)) = stats.next().await {
            if on_message.send(streams::stats_sample(&s)).is_err() {
                break;
            }
        }
        tauri::Manager::state::<AppState>(&app)
            .streams
            .done(stream_id);
    });
    state.streams.add(stream_id, window.label(), task);
    Ok(stream_id)
}

/// Against a real engine (`cargo test --features integration`): logs, a TTY
/// shell and stats from a throwaway python:3.12-slim container.
#[cfg(all(test, feature = "integration"))]
mod integration {
    use super::*;
    use crate::engine::Engine;
    use bollard::models::ContainerCreateBody;
    use bollard::query_parameters::{CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder};

    const IMAGE: &str = "python:3.12-slim";

    #[tokio::test]
    async fn logs_terminal_and_stats() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        if docker.inspect_image(IMAGE).await.is_err() {
            eprintln!("skipped: {IMAGE} isn't on this engine");
            return;
        }
        let name = format!("dcc-streams-{}", std::process::id());
        let body = ContainerCreateBody {
            image: Some(IMAGE.into()),
            cmd: Some(vec![
                "sh".into(),
                "-c".into(),
                r"echo hello; echo oops >&2; printf '\033[31mred\033[0m\n'; sleep 300".into(),
            ]),
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
        docker.start_container(&id, None).await.expect("start");
        tokio::time::sleep(Duration::from_millis(800)).await;

        // Logs: split by stream, timestamps parsed, colours stripped.
        let q = LogQuery {
            follow: false,
            tail: None,
            since: None,
            until: None,
        };
        let mut logs = Box::pin(docker.logs(&id, Some(logs_options(&q))));
        let mut split = LineSplitter::default();
        let mut lines = vec![];
        while let Some(f) = logs.next().await {
            push_frame(&mut split, f.expect("frame"), &mut lines);
        }
        split.finish(&mut lines);
        let texts: Vec<(bool, &str)> = lines.iter().map(|l| (l.err, l.text.as_str())).collect();
        assert!(texts.contains(&(false, "hello")), "{texts:?}");
        assert!(texts.contains(&(true, "oops")), "{texts:?}");
        assert!(texts.contains(&(false, "red")), "{texts:?}");
        assert!(
            lines.iter().all(|l| l.time.len() >= 20),
            "timestamps: {lines:?}"
        );

        // Terminal: type a command, read its output, exit.
        let opts = CreateExecOptions::<String> {
            attach_stdin: Some(true),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            tty: Some(true),
            cmd: Some(vec!["/bin/sh".into(), "-c".into(), SHELL.into()]),
            ..Default::default()
        };
        let exec_id = docker.create_exec(&id, opts).await.expect("exec").id;
        let StartExecResults::Attached {
            mut output,
            mut input,
        } = docker
            .start_exec(
                &exec_id,
                Some(StartExecOptions {
                    detach: false,
                    tty: true,
                    output_capacity: None,
                }),
            )
            .await
            .expect("start exec")
        else {
            panic!("not attached");
        };
        docker
            .resize_exec(
                &exec_id,
                ResizeExecOptions {
                    height: 30,
                    width: 100,
                },
            )
            .await
            .expect("resize");
        input
            .write_all(b"echo dcc-$((40+2)); exit 3\n")
            .await
            .unwrap();
        let mut carry = Utf8Carry::default();
        let mut seen = String::new();
        let read = async {
            while let Some(Ok(f)) = output.next().await {
                seen.push_str(&carry.push(&f.into_bytes()));
            }
        };
        tokio::time::timeout(Duration::from_secs(10), read)
            .await
            .expect("shell exited");
        assert!(seen.contains("dcc-42"), "{seen:?}");
        assert_eq!(
            docker.inspect_exec(&exec_id).await.unwrap().exit_code,
            Some(3)
        );

        // Stats: one sample with memory and a process count.
        let sopts = StatsOptionsBuilder::new()
            .stream(false)
            .one_shot(false)
            .build();
        let s = Box::pin(docker.stats(&id, Some(sopts)))
            .next()
            .await
            .expect("sample")
            .expect("stats");
        let sample = streams::stats_sample(&s);
        assert!(sample.mem_used > 0 && sample.mem_limit > 0, "{sample:?}");
        assert!(sample.pids >= 1, "{sample:?}");

        docker
            .remove_container(
                &id,
                Some(RemoveContainerOptionsBuilder::new().force(true).build()),
            )
            .await
            .expect("remove");
    }
}
