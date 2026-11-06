//! App entry: registers state, plugins and every command the UI can call.
//! Add a section's commands to `generate_handler!` below.

mod commands;
mod containers;
mod engine;
mod error;
mod settings;
mod util;
mod window;

use commands::AppState;
use settings::SettingsStore;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(AppState {
                settings: SettingsStore::new(dir),
                engine: engine::Engine::from_env(),
                watcher: Default::default(),
            });
            if let Some(main) = app.get_webview_window("main") {
                window::restore(&main, &app.state::<AppState>().settings);
                window::save_on_close(&main);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_theme,
            commands::remember_filter,
            commands::forget_filter,
            commands::set_value,
            commands::pick_folder,
            commands::pick_open_file,
            commands::pick_save_file,
            commands::engine::engine_info,
            commands::engine::list_containers,
            commands::engine::watch_engine,
            commands::engine::container_action,
            commands::engine::inspect_container,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
