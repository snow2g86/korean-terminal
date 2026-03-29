mod commands;
mod pty_manager;

use pty_manager::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::new())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_create,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_destroy,
            commands::pty_get_cwd,
            commands::get_sysinfo,
            commands::get_input_source,
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::find_files,
            commands::load_settings,
            commands::save_settings,
            commands::load_prefs,
            commands::save_prefs,
            commands::log_from_js,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let pty = window.state::<PtyManager>();
                pty.destroy_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("한텀 실행 오류");
}
