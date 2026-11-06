//! Pop-out windows: one place (a container's logs, terminal, …) in its own
//! window. The page reads `?popout=<address>` and shows only that place.

use super::AppState;
use crate::error::AppError;
use crate::streams::url_encode;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub fn open_popout(app: AppHandle, address: String, title: String) -> Result<(), AppError> {
    let label = format!("popout-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let url = WebviewUrl::App(format!("index.html?popout={}", url_encode(&address)).into());
    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("{title} - Docker Control Centre"))
        .inner_size(960.0, 620.0)
        .min_inner_size(480.0, 300.0)
        .build()
        .map_err(|e| AppError::from(format!("Couldn't open a window: {e}")))?;
    // When it closes, stop everything it was watching.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let state = handle.state::<AppState>();
            if let Some(w) = state.watchers.lock().unwrap().remove(&label) {
                w.abort();
            }
            state.streams.stop_window(&label);
            let label = label.clone();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                super::streams::close_window_terminals(&handle.state::<AppState>(), &label).await;
            });
        }
    });
    Ok(())
}
