//! App entry: registers state, plugins and every command the UI can call.
//! Add a section's commands to `generate_handler!` below.

mod commands;
mod compose;
mod container_files;
mod containers;
mod engine;
mod error;
mod resources;
mod settings;
mod stats_totals;
mod streams;
mod tar;
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
                watchers: Default::default(),
                streams: Default::default(),
                terminals: Default::default(),
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
            commands::about_info,
            commands::open_project_page,
            commands::engine::engine_info,
            commands::engine::list_containers,
            commands::engine::watch_engine,
            commands::engine::container_action,
            commands::engine::inspect_container,
            commands::streams::stream_logs,
            commands::streams::stop_stream,
            commands::streams::export_logs,
            commands::streams::terminal_open,
            commands::streams::terminal_input,
            commands::streams::terminal_resize,
            commands::streams::terminal_close,
            commands::streams::stream_stats,
            commands::streams::stream_stats_totals,
            commands::window::open_popout,
            commands::files::list_container_dir,
            commands::files::copy_from_container,
            commands::files::copy_into_container,
            commands::compose::compose_run,
            commands::compose::compose_check,
            commands::compose::wsl_distros,
            commands::compose::compose_pinned,
            commands::compose::compose_pin,
            commands::compose::compose_project_name,
            commands::compose::compose_drop_candidates,
            commands::compose::compose_unpin,
            commands::compose::compose_read_file,
            commands::compose::compose_show_file,
            commands::compose::save_text_file,
            commands::resources::list_images,
            commands::resources::inspect_image,
            commands::resources::remove_images,
            commands::resources::pull_image,
            commands::resources::list_volumes,
            commands::resources::remove_volumes,
            commands::resources::list_networks,
            commands::resources::remove_networks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
