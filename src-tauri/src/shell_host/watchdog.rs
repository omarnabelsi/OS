//! Crash watchdog. V1: log panics with a backtrace to `<data_dir>/logs/crash.log` and make sure a
//! panic never leaves a fullscreen, always-on-top window stuck on screen. V2 adds the external
//! supervisor process that restarts the shell (or restores Explorer) when it dies.

use std::io::Write;
use std::time::Duration;

use tauri::{AppHandle, Manager};

pub fn install_panic_hook(app: &AppHandle) {
    let handle = app.clone();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "[{}] panic: {}\n{}\n\n",
            chrono_like_now(),
            info,
            std::backtrace::Backtrace::force_capture()
        );
        log::error!("{msg}");
        if let Some(state) = handle.try_state::<crate::state::AppState>() {
            let path = state.core.paths.log_dir.join("crash.log");
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = f.write_all(msg.as_bytes());
            }
        }
        // Never leave the user trapped behind a topmost fullscreen window.
        if let Some(win) = handle.get_webview_window(super::window::MAIN) {
            let _ = win.set_always_on_top(false);
            let _ = win.set_fullscreen(false);
        }
        default_hook(info);
    }));
}

/// `--smoke`: exit cleanly after `secs`, printing a marker CI can grep for.
pub fn schedule_smoke_exit(app: &AppHandle, secs: u64) {
    let handle = app.clone();
    std::thread::Builder::new()
        .name("aura-smoke".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_secs(secs));
            println!("AURA_SMOKE_OK");
            log::info!("smoke run complete after {secs}s");
            handle.exit(0);
        })
        .expect("spawn smoke thread");
}

fn chrono_like_now() -> String {
    // Avoid pulling chrono into the host crate just for a timestamp.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}
