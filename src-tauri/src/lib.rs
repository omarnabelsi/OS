//! Aura Shell host (Layer 1) + IPC bridge (Layer 3).
//!
//! - `shell_host` owns the window, monitors, hotkeys, CLI args and the crash watchdog.
//! - `ipc` exposes `aura_core::Core` to the UI as Tauri commands and forwards core events.
//! - `state` is the `tauri::State` payload shared by every command.
//!
//! The UI never touches Windows APIs; it only calls the commands registered below.

pub mod ipc;
pub mod shell_host;
pub mod state;

use std::sync::Arc;

use aura_core::{Core, Paths};
use tauri::Manager;

use shell_host::args::Args;
use state::AppState;

pub fn run() {
    let args = Args::parse(std::env::args().skip(1));
    if let Some(dir) = &args.data_dir {
        // Must be set before Core::new resolves Paths.
        std::env::set_var("AURA_DATA_DIR", dir);
    }

    let setup_args = args.clone();
    tauri::Builder::default()
        // Single-instance must be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            shell_host::window::focus_main(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle().clone();
            shell_host::watchdog::install_panic_hook(&handle);

            let bundled_themes = shell_host::resolve_bundled_themes_dir(&handle);
            let paths = Paths::discover(bundled_themes)?;
            log::info!("data dir: {}", paths.data_dir.display());

            let sink = Arc::new(ipc::events::TauriEventSink::new(handle.clone()));
            let core = Core::new(paths, sink)?;
            let settings = core.settings();

            if settings.gamepad_enabled {
                core.start_input();
            }

            let version = app.package_info().version.to_string();
            app.manage(AppState {
                core: core.clone(),
                args: setup_args.clone(),
                version,
            });

            shell_host::window::configure_main_window(&handle, &settings, &setup_args)?;
            shell_host::window::install_launch_hooks(&handle, settings.hide_shell_on_launch);
            // Logged at error, not warn: this is the documented way out of a fullscreen shell.
            // The UI also asks for `get_exit_hotkey_status` on startup and tells the user, so a
            // failure here is never silent.
            if let Err(e) = shell_host::hotkeys::bind_exit_hotkey(&handle, &settings.exit_hotkey) {
                log::error!("exit hotkey `{}` not registered: {e}", settings.exit_hotkey);
            }

            // A first run must open onto the user's library arranged as folders, not an empty
            // wallpaper. No-op once a desktop exists.
            match core.seed_desktop() {
                Ok(Some(d)) => log::info!("seeded the default desktop `{}`", d.name),
                Ok(None) => {}
                Err(e) => log::error!("could not seed the default desktop: {e}"),
            }

            if setup_args.smoke {
                shell_host::watchdog::schedule_smoke_exit(&handle, setup_args.smoke_secs);
            } else if settings.scan_on_startup {
                core.scan_library(aura_core::library::scanners::supported_sources());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::get_app_info,
            ipc::commands::get_settings,
            ipc::commands::update_settings,
            ipc::commands::get_exit_hotkey_status,
            ipc::commands::list_entries,
            ipc::commands::get_entry,
            ipc::commands::add_manual_entry,
            ipc::commands::update_entry,
            ipc::commands::remove_entry,
            ipc::commands::scan_library,
            ipc::commands::fetch_artwork,
            ipc::commands::set_artwork_override,
            ipc::commands::launch_entry,
            ipc::commands::active_sessions,
            ipc::commands::list_desktops,
            ipc::commands::get_desktop,
            ipc::commands::create_desktop,
            ipc::commands::update_desktop,
            ipc::commands::delete_desktop,
            ipc::commands::list_desktop_items,
            ipc::commands::add_desktop_item,
            ipc::commands::update_desktop_item,
            ipc::commands::remove_desktop_item,
            ipc::commands::list_folders,
            ipc::commands::get_folder,
            ipc::commands::create_folder,
            ipc::commands::update_folder,
            ipc::commands::set_folder_cover,
            ipc::commands::delete_folder,
            ipc::commands::folder_contents,
            ipc::commands::list_taskbar_items,
            ipc::commands::pin_to_taskbar,
            ipc::commands::unpin_from_taskbar,
            ipc::commands::reorder_taskbar,
            ipc::commands::get_system_status,
            ipc::commands::list_themes,
            ipc::commands::get_theme,
            ipc::commands::set_active_theme,
            ipc::commands::get_monitors,
            ipc::commands::set_fullscreen,
            ipc::commands::shell_ready,
            ipc::commands::exit_shell,
            ipc::commands::minimize_shell,
            ipc::commands::get_window_state,
            ipc::commands::toggle_maximize_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura Shell");
}
