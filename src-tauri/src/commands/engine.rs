//! Engine commands: info, container list, and the change feed the UI uses to
//! keep lists live.

use super::AppState;
use crate::engine::{self, ContainerItem, EngineInfo, EngineMessage};
use crate::error::AppError;
use bollard::query_parameters::ListContainersOptionsBuilder;
use futures_util::StreamExt;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
pub async fn engine_info(state: State<'_, AppState>) -> Result<EngineInfo, AppError> {
    let e = &state.engine;
    let info = e.docker()?.info().await.map_err(|x| e.error(x))?;
    Ok(engine::engine_info(e.endpoint.display(), info))
}

#[tauri::command]
pub async fn list_containers(state: State<'_, AppState>) -> Result<Vec<ContainerItem>, AppError> {
    let e = &state.engine;
    let opts = ListContainersOptionsBuilder::new().all(true).build();
    let list = e
        .docker()?
        .list_containers(Some(opts))
        .await
        .map_err(|x| e.error(x))?;
    Ok(list.into_iter().map(engine::container_item).collect())
}

/// Starts (or restarts) the change feed. Runs until the app exits or the UI
/// calls this again (a reload): pings, reports connected, forwards events, and
/// on any failure reports disconnected and retries with backoff.
#[tauri::command]
pub fn watch_engine(
    state: State<'_, AppState>,
    on_message: Channel<EngineMessage>,
) -> Result<(), AppError> {
    let docker = state.engine.docker()?.clone();
    let endpoint = state.engine.endpoint.display().to_string();
    let task = tauri::async_runtime::spawn(async move {
        let mut delay = Duration::from_secs(1);
        loop {
            match docker.ping().await {
                Ok(_) => {
                    delay = Duration::from_secs(1);
                    if on_message.send(EngineMessage::Connected).is_err() {
                        return;
                    }
                    let mut events = docker.events(None);
                    let reason = loop {
                        match events.next().await {
                            Some(Ok(ev)) => {
                                if let Some(msg) = engine::change_of(&ev) {
                                    if on_message.send(msg).is_err() {
                                        return;
                                    }
                                }
                            }
                            Some(Err(err)) => break engine::map_error(&endpoint, err).message,
                            None => {
                                break format!("The engine at {endpoint} closed the connection.")
                            }
                        }
                    };
                    if on_message
                        .send(EngineMessage::Disconnected { message: reason })
                        .is_err()
                    {
                        return;
                    }
                }
                Err(err) => {
                    let message = engine::map_error(&endpoint, err).message;
                    if on_message
                        .send(EngineMessage::Disconnected { message })
                        .is_err()
                    {
                        return;
                    }
                }
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(10));
        }
    });
    if let Some(old) = state.watcher.lock().unwrap().replace(task) {
        old.abort();
    }
    Ok(())
}
