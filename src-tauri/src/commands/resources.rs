//! Images, volumes and networks: list, inspect, remove (one result per item),
//! and pulling an image with progress.

use super::AppState;
use crate::containers::ActionResult;
use crate::engine::map_error;
use crate::error::AppError;
use crate::resources::{
    self, ImageDetails, ImageItem, NetworkItem, PullMessage, PullState, VolumeItem,
};
use bollard::query_parameters::{
    CreateImageOptionsBuilder, ListImagesOptionsBuilder, RemoveImageOptionsBuilder,
    RemoveVolumeOptionsBuilder,
};
use futures_util::future::join_all;
use futures_util::StreamExt;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State, Window};

#[tauri::command]
pub async fn list_images(state: State<'_, AppState>) -> Result<Vec<ImageItem>, AppError> {
    let e = &state.engine;
    let opts = ListImagesOptionsBuilder::new().all(false).build();
    let list = e
        .docker()?
        .list_images(Some(opts))
        .await
        .map_err(|x| e.error(x))?;
    Ok(list.into_iter().map(resources::image_item).collect())
}

#[tauri::command]
pub async fn inspect_image(
    state: State<'_, AppState>,
    id: String,
) -> Result<ImageDetails, AppError> {
    let e = &state.engine;
    let docker = e.docker()?;
    let (inspect, history) =
        futures_util::join!(docker.inspect_image(&id), docker.image_history(&id));
    Ok(resources::image_details(
        inspect.map_err(|x| e.error(x))?,
        history.unwrap_or_default(),
    ))
}

/// Removes images by reference (a tag removes that tag; an id the image).
/// `force` also removes images that stopped containers use.
#[tauri::command]
pub async fn remove_images(
    state: State<'_, AppState>,
    refs: Vec<String>,
    force: bool,
) -> Result<Vec<ActionResult>, AppError> {
    let e = &state.engine;
    let docker = e.docker()?;
    let endpoint = e.endpoint.display();
    // One at a time: tags of the same image would otherwise race each other.
    let mut out = vec![];
    for id in refs {
        let opts = RemoveImageOptionsBuilder::new().force(force).build();
        let r = docker.remove_image(&id, Some(opts), None).await;
        out.push(ActionResult {
            error: r.err().map(|x| map_error(endpoint, x).message),
            id,
        });
    }
    Ok(out)
}

/// Gathers progress for this long before sending, so a fast pull doesn't flood the UI.
const PULL_TICK: Duration = Duration::from_millis(120);

#[tauri::command]
pub fn pull_image(
    window: Window,
    state: State<'_, AppState>,
    reference: String,
    on_message: Channel<PullMessage>,
) -> Result<u64, AppError> {
    let (image, tag) = resources::split_reference(&reference);
    if image.is_empty() {
        return Err(AppError::invalid(
            "Enter an image name, such as nginx:latest.",
        ));
    }
    let docker = state.engine.docker()?.clone();
    let endpoint = state.engine.endpoint.display().to_string();
    let id = state.streams.next_id();
    let app = window.app_handle().clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut b = CreateImageOptionsBuilder::new().from_image(&image);
        if !tag.is_empty() {
            b = b.tag(&tag);
        }
        let mut events = Box::pin(docker.create_image(Some(b.build()), None, None));
        let mut state = PullState::default();
        let mut next_send = tokio::time::Instant::now();
        loop {
            match tokio::time::timeout_at(next_send + PULL_TICK, events.next()).await {
                Ok(Some(Ok(ev))) => state.apply(ev),
                Ok(Some(Err(err))) => {
                    state.error = Some(map_error(&endpoint, err).message);
                    break;
                }
                Ok(None) => break,
                Err(_) => {}
            }
            if state.error.is_some() {
                break;
            }
            if tokio::time::Instant::now() >= next_send {
                let msg = PullMessage::Progress {
                    layers: state.layers.clone(),
                    status: state.status.clone(),
                };
                if on_message.send(msg).is_err() {
                    return;
                }
                next_send = tokio::time::Instant::now() + PULL_TICK;
            }
        }
        let _ = on_message.send(PullMessage::Progress {
            layers: state.layers.clone(),
            status: state.status.clone(),
        });
        let _ = on_message.send(PullMessage::Done {
            error: state.error,
            status: state.status,
        });
        app.state::<AppState>().streams.done(id);
    });
    state.streams.add(id, window.label(), task);
    Ok(id)
}

#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> Result<Vec<VolumeItem>, AppError> {
    let e = &state.engine;
    let r = e
        .docker()?
        .list_volumes(None::<bollard::query_parameters::ListVolumesOptions>)
        .await
        .map_err(|x| e.error(x))?;
    let mut v: Vec<VolumeItem> = r
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(resources::volume_item)
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(v)
}

#[tauri::command]
pub async fn remove_volumes(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> Result<Vec<ActionResult>, AppError> {
    let e = &state.engine;
    let docker = e.docker()?;
    let endpoint = e.endpoint.display();
    let runs = names.into_iter().map(|id| async move {
        let r = docker
            .remove_volume(
                &id,
                Some(RemoveVolumeOptionsBuilder::new().force(false).build()),
            )
            .await;
        ActionResult {
            error: r.err().map(|x| map_error(endpoint, x).message),
            id,
        }
    });
    Ok(join_all(runs).await)
}

#[tauri::command]
pub async fn list_networks(state: State<'_, AppState>) -> Result<Vec<NetworkItem>, AppError> {
    let e = &state.engine;
    let list = e
        .docker()?
        .list_networks(None)
        .await
        .map_err(|x| e.error(x))?;
    let mut v: Vec<NetworkItem> = list.into_iter().map(resources::network_item).collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(v)
}

#[tauri::command]
pub async fn remove_networks(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<ActionResult>, AppError> {
    let e = &state.engine;
    let docker = e.docker()?;
    let endpoint = e.endpoint.display();
    let runs = ids.into_iter().map(|id| async move {
        let r = docker.remove_network(&id).await;
        ActionResult {
            error: r.err().map(|x| map_error(endpoint, x).message),
            id,
        }
    });
    Ok(join_all(runs).await)
}
