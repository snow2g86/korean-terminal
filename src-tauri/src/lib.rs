mod commands;
mod pty_manager;

use pty_manager::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::new())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = _app.get_webview_window("main") {
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
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                // 창 닫기 전/후 모두에서 정리 — 다중 창에 대비
                let pty = window.state::<PtyManager>();
                pty.destroy_all();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("한텀 빌드 오류");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            let pty = app_handle.state::<PtyManager>();
            pty.destroy_all();
        }
        tauri::RunEvent::Exit => {
            let pty = app_handle.state::<PtyManager>();
            pty.destroy_all();
        }
        _ => {}
    });
}
