//! Engine commands: info, container list, and the change feed the UI uses to
//! keep lists live.

use super::AppState;
use crate::containers::{self, ActionResult, ContainerAction, ContainerDetails};
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
    let mut items: Vec<ContainerItem> = list.into_iter().map(engine::container_item).collect();

    // Containers that aren't running have no ports in the list: show what
    // they're configured to publish. That never changes for a container id,
    // so each is inspected once (a few at a time) and remembered.
    let docker = e.docker()?;
    let missing: Vec<String> = {
        let cache = state.port_config.lock().unwrap();
        items
            .iter()
            .filter(|c| engine::needs_configured_ports(c) && !cache.contains_key(&c.id))
            .map(|c| c.id.clone())
            .collect()
    };
    let fetched: Vec<(String, Vec<String>)> = futures_util::stream::iter(missing)
        .map(|id| async move {
            // Gone meanwhile, or the engine refused: try again on the next list.
            let r = docker.inspect_container(&id, None).await.ok()?;
            Some((id, engine::configured_ports(&r)))
        })
        .buffer_unordered(8)
        .filter_map(|x| async move { x })
        .collect()
        .await;
    let mut cache = state.port_config.lock().unwrap();
    cache.extend(fetched);
    cache.retain(|id, _| items.iter().any(|c| &c.id == id));
    for c in items
        .iter_mut()
        .filter(|c| engine::needs_configured_ports(c))
    {
        c.configured_ports = cache.get(&c.id).cloned().unwrap_or_default();
    }
    Ok(items)
}

/// Starts (or restarts) this window's change feed. Runs until the app exits or the UI
/// calls this again (a reload): pings, reports connected, forwards events, and
/// on any failure reports disconnected and retries with backoff.
#[tauri::command]
pub fn watch_engine(
    window: tauri::Window,
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
    // One feed per window: a reload replaces it, a pop-out gets its own.
    if let Some(old) = state
        .watchers
        .lock()
        .unwrap()
        .insert(window.label().to_string(), task)
    {
        old.abort();
    }
    Ok(())
}

/// Runs `action` on each container concurrently; one result per id, so the UI
/// can say which failed.
#[tauri::command]
pub async fn container_action(
    state: State<'_, AppState>,
    ids: Vec<String>,
    action: ContainerAction,
) -> Result<Vec<ActionResult>, AppError> {
    let e = &state.engine;
    Ok(containers::run_action(e.docker()?, e.endpoint.display(), ids, action).await)
}

#[tauri::command]
pub async fn inspect_container(
    state: State<'_, AppState>,
    id: String,
) -> Result<ContainerDetails, AppError> {
    let e = &state.engine;
    let c = e
        .docker()?
        .inspect_container(&id, None)
        .await
        .map_err(|x| e.error(x))?;
    Ok(containers::container_details(c))
}
