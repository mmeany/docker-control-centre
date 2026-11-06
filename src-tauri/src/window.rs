//! Remembers the main window's size, position and maximised state between
//! runs (in settings `values`, key `app.window`). The window starts hidden
//! (tauri.conf.json) so it can be placed before it's shown.

use crate::settings::SettingsStore;
use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent};

const KEY: &str = "app.window";
/// How much of the title bar must be on a monitor to restore the position.
const MIN_VISIBLE: i32 = 80;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A monitor's area in physical pixels: x, y, width, height.
pub type Area = (i32, i32, u32, u32);

/// Whether enough of the window's top edge lands on some monitor to grab it
/// (a monitor may have been unplugged since).
pub fn on_screen(g: &Geometry, monitors: &[Area]) -> bool {
    monitors.iter().any(|&(mx, my, mw, mh)| {
        let (right, bottom) = (mx + mw as i32, my + mh as i32);
        let overlap = (g.x + g.width as i32).min(right) - g.x.max(mx);
        overlap >= MIN_VISIBLE && g.y >= my && g.y + 20 <= bottom
    })
}

fn load(store: &SettingsStore) -> Option<Geometry> {
    store
        .load()
        .values
        .get(KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .filter(|g: &Geometry| g.width >= 400 && g.height >= 300)
}

/// Applies the saved geometry, then shows the window.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>, store: &SettingsStore) {
    if let Some(g) = load(store) {
        let monitors: Vec<Area> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| {
                (
                    m.position().x,
                    m.position().y,
                    m.size().width,
                    m.size().height,
                )
            })
            .collect();
        let _ = window.set_size(PhysicalSize::new(g.width, g.height));
        if on_screen(&g, &monitors) {
            let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
        }
        if g.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
}

/// Saves the geometry when the window is closing. While maximised, the size
/// and position from before maximising are kept.
pub fn save_on_close<R: Runtime>(window: &WebviewWindow<R>) {
    let w = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::CloseRequested { .. }) {
            return;
        }
        let store = &w.state::<crate::commands::AppState>().settings;
        let maximized = w.is_maximized().unwrap_or(false);
        let mut g = load(store).unwrap_or(Geometry {
            x: 0,
            y: 0,
            width: 1100,
            height: 700,
            maximized,
        });
        g.maximized = maximized;
        if !maximized && !w.is_minimized().unwrap_or(false) {
            if let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) {
                (g.x, g.y, g.width, g.height) = (p.x, p.y, s.width, s.height);
            }
        }
        if let Ok(v) = serde_json::to_value(g) {
            let _ = store.update(|s| {
                s.values.insert(KEY.into(), v);
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const G: Geometry = Geometry {
        x: 100,
        y: 100,
        width: 1100,
        height: 700,
        maximized: false,
    };

    #[test]
    fn keeps_windows_reachable() {
        let one = [(0, 0, 1920, 1080)];
        assert!(on_screen(&G, &one));
        assert!(
            !on_screen(&Geometry { x: 2500, ..G }, &one),
            "monitor unplugged"
        );
        assert!(
            !on_screen(&Geometry { y: -50, ..G }, &one),
            "title bar above the screen"
        );
        assert!(
            !on_screen(&Geometry { x: 1880, ..G }, &one),
            "only a sliver visible"
        );
        let two = [(0, 0, 1920, 1080), (-2560, 0, 2560, 1440)];
        assert!(
            on_screen(&Geometry { x: -2000, ..G }, &two),
            "left-hand monitor"
        );
    }
}
