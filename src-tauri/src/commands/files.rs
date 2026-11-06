//! Files inside containers: list a folder, copy out, copy in.

use super::AppState;
use crate::container_files::{self, CopyResult, Listing};
use crate::error::AppError;
use tauri::State;

/// Lists a folder. `running` says whether exec can be tried first.
#[tauri::command]
pub async fn list_container_dir(
    state: State<'_, AppState>,
    id: String,
    path: String,
    running: bool,
) -> Result<Listing, AppError> {
    let e = &state.engine;
    let path = container_files::clean_path(&path)?;
    container_files::list(e.docker()?, &id, &path, running)
        .await
        .map_err(|x| e.error(x))
}

/// Saves a file (or a folder, as .tar) from the container to `dest`.
#[tauri::command]
pub async fn copy_from_container(
    state: State<'_, AppState>,
    id: String,
    path: String,
    dest: String,
) -> Result<CopyResult, AppError> {
    let path = container_files::clean_path(&path)?;
    container_files::copy_out(
        state.engine.docker()?,
        &id,
        &path,
        std::path::Path::new(&dest),
    )
    .await
}

/// Copies files and folders from this computer into a folder in the
/// container; returns how many files went in.
#[tauri::command]
pub async fn copy_into_container(
    state: State<'_, AppState>,
    id: String,
    dir: String,
    sources: Vec<String>,
) -> Result<usize, AppError> {
    let e = &state.engine;
    let dir = container_files::clean_path(&dir)?;
    let (archive, count) =
        tauri::async_runtime::spawn_blocking(move || container_files::pack(&sources))
            .await
            .map_err(|x| AppError::from(x.to_string()))??;
    container_files::copy_in(e.docker()?, &id, &dir, archive)
        .await
        .map_err(|x| e.error(x))?;
    Ok(count)
}
