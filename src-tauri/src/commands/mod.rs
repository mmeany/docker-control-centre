//! Tauri commands: the only surface the UI can call. Kept thin; logic lives in
//! modules. App-level commands are here; each section has its own submodule.

pub mod engine;
pub mod streams;
pub mod window;

use crate::error::AppError;
use crate::settings::{Settings, SettingsStore, ThemePref};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tokio::sync::oneshot;

pub struct AppState {
    pub settings: SettingsStore,
    pub engine: crate::engine::Engine,
    /// Each window's change feed, by window label (see `engine::watch_engine`).
    pub watchers:
        std::sync::Mutex<std::collections::HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    /// Logs, stats and terminal output tasks.
    pub streams: crate::streams::StreamRegistry,
    /// Open terminals by session id.
    pub terminals: tokio::sync::Mutex<std::collections::HashMap<u64, streams::Terminal>>,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.load()
}

#[tauri::command]
pub fn set_theme(state: State<'_, AppState>, theme: ThemePref) -> Result<Settings, AppError> {
    Ok(state.settings.update(|s| s.theme = theme)?)
}

/// Remembers a filter (newest first, deduplicated); returns that key's history.
#[tauri::command]
pub fn remember_filter(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<Vec<String>, AppError> {
    let s = state.settings.update(|s| s.remember_filter(&key, &value))?;
    Ok(s.filter_history.get(&key).cloned().unwrap_or_default())
}

/// Removes one filter from the history, or all of them when `value` is null.
#[tauri::command]
pub fn forget_filter(
    state: State<'_, AppState>,
    key: String,
    value: Option<String>,
) -> Result<Vec<String>, AppError> {
    let s = state.settings.update(|s| match &value {
        Some(v) => s.forget_filter(&key, v),
        None => {
            s.filter_history.remove(&key);
        }
    })?;
    Ok(s.filter_history.get(&key).cloned().unwrap_or_default())
}

/// Stores a small JSON value under `key`; null removes it.
#[tauri::command]
pub fn set_value(
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> Result<Settings, AppError> {
    if key.trim().is_empty() || key.len() > 200 {
        return Err(AppError::invalid(
            "Setting keys must be 1 to 200 characters",
        ));
    }
    if value.to_string().len() > 64 * 1024 {
        return Err(AppError::invalid(
            "Setting values are limited to 64 KB; keep larger data in its own file",
        ));
    }
    Ok(state.settings.update(|s| {
        if value.is_null() {
            s.values.remove(&key);
        } else {
            s.values.insert(key, value);
        }
    })?)
}

// ---------------------------------------------------------------------------
// Native dialogs (opened from Rust so the UI needs no extra plugin/permissions)

fn dialog(app: &AppHandle, title: &str) -> FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file().set_title(title);
    if let Some(win) = app.get_webview_window("main") {
        d = d.set_parent(&win);
    }
    d
}

/// Folder picker. None when cancelled.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    dialog(&app, &title).pick_folder(move |f| {
        let _ = tx.send(f);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Single-file open dialog filtered to `extensions` (plus "All files").
#[tauri::command]
pub async fn pick_open_file(
    app: AppHandle,
    title: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    dialog(&app, &title)
        .add_filter(&filter_name, &exts)
        .add_filter("All files", &["*"])
        .pick_file(move |f| {
            let _ = tx.send(f);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Save-as dialog (asks about overwriting itself). None when cancelled.
#[tauri::command]
pub async fn pick_save_file(app: AppHandle, title: String, default_name: String) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    dialog(&app, &title)
        .set_file_name(crate::util::safe_file_name(&default_name))
        .save_file(move |f| {
            let _ = tx.send(f);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}
