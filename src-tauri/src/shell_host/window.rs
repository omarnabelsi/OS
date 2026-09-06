//! Main window lifecycle: fullscreen/windowed setup, hide-on-launch / restore-on-exit.
//!
//! STATUS: first implementation - owner shell-host agent verifies against Tauri 2 API and
//! hardens multi-monitor + DPI behaviour.

use aura_core::Settings;
use tauri::{AppHandle, Listener, LogicalSize, Manager, WebviewWindow};

use super::args::Args;

pub const MAIN: &str = "main";

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// Apply settings + CLI overrides. The window stays hidden until `reveal` (called by the UI via
/// `shell_ready`) so the user never sees an unstyled frame.
pub fn configure_main_window(app: &AppHandle, settings: &Settings, args: &Args) -> tauri::Result<()> {
    let Some(win) = main_window(app) else { return Ok(()) };
    let fullscreen = settings.start_fullscreen && !args.windowed && !args.smoke;

    if let Some(idx) = settings.monitor_index {
        if let Some(monitor) = win.available_monitors()?.into_iter().nth(idx as usize) {
            win.set_position(*monitor.position())?;
        }
    }

    win.set_decorations(false)?;
    if fullscreen {
        win.set_fullscreen(true)?;
        win.set_always_on_top(settings.always_on_top)?;
    } else {
        win.set_fullscreen(false)?;
        win.set_always_on_top(false)?;
        win.set_size(LogicalSize::new(1280.0, 720.0))?;
        win.center()?;
    }
    Ok(())
}

/// Show + focus after the UI's first paint.
pub fn reveal(win: &WebviewWindow) -> tauri::Result<()> {
    win.show()?;
    win.set_focus()?;
    Ok(())
}

pub fn focus_main(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Get out of the way while a game runs. Minimising (rather than hiding) keeps the window in the
/// taskbar so the user can always get back with the mouse.
pub fn hide_for_launch(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.set_always_on_top(false);
        let _ = win.minimize();
    }
}

pub fn restore_after_launch(app: &AppHandle, always_on_top: bool) {
    if let Some(win) = main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        if win.is_fullscreen().unwrap_or(false) {
            let _ = win.set_always_on_top(always_on_top);
        }
    }
}

/// React to the process service: minimise on `process://started`, restore on `process://exited`.
pub fn install_launch_hooks(app: &AppHandle, hide_on_launch: bool) {
    if hide_on_launch {
        let h = app.clone();
        app.listen("process://started", move |_| hide_for_launch(&h));
    }
    let h = app.clone();
    app.listen("process://exited", move |_| {
        let always_on_top = h
            .try_state::<crate::state::AppState>()
            .map(|s| s.core.settings().always_on_top)
            .unwrap_or(false);
        restore_after_launch(&h, always_on_top);
    });
}
