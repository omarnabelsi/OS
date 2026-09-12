//! Main window lifecycle: fullscreen/windowed setup, maximise, hide-on-launch / restore-on-exit.
//!
//! Every change to the native window's state goes through this module. The UI never calls
//! `@tauri-apps/api/window` itself; it asks for a command, and the command asks here, so the
//! rules about topmost, size and remembered state live in exactly one place.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use aura_core::Settings;
use serde::Serialize;
use tauri::{
    AppHandle, Listener, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

use super::args::Args;

pub const MAIN: &str = "main";

/// Share of the target monitor the window takes when it is not fullscreen.
const WINDOWED_FRACTION: f64 = 0.8;
/// Upper bound on the windowed size, so a 4K or ultrawide desktop does not produce a window
/// too large to move.
const WINDOWED_MAX: (f64, f64) = (2560.0, 1440.0);
/// Lower bound, matching `minWidth`/`minHeight` in tauri.conf.json.
const WINDOWED_MIN: (f64, f64) = (960.0, 540.0);
/// Used only when no monitor can be identified at all (headless CI, a display unplugged
/// mid-launch). Never a size we choose on purpose.
const WINDOWED_FALLBACK: (f64, f64) = (1600.0, 900.0);

/// Whether the window was fullscreen before we minimised it for a launch.
///
/// Windows can drop a borderless window out of fullscreen as a side effect of minimising, so
/// `is_fullscreen()` after the round trip is not trustworthy. Seeded by
/// `configure_main_window` and re-read by `restore_after_launch`.
static WAS_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Where the windowed shell was the last time it went fullscreen, to come back to on the way out.
///
/// Needed because the window is *created* fullscreen (tauri.conf.json), so the size the OS would
/// restore on leaving fullscreen is the config's 1920x1080 fallback - larger than the entire
/// desktop on a 1366x768 laptop. With nothing remembered yet, leaving fullscreen falls back to a
/// size proportional to the monitor instead.
static LAST_WINDOWED: Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>> = Mutex::new(None);

/// What the UI needs to know about the native window.
///
/// The shell's title bar is drawn only while `fullscreen` is false, and shows "restore" rather
/// than "maximise" while `maximized` is true.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellWindowState {
    pub fullscreen: bool,
    pub maximized: bool,
    pub minimized: bool,
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// Settings plus CLI overrides: `--windowed` and `--smoke` both win over the stored preference.
pub fn wants_fullscreen(settings: &Settings, args: &Args) -> bool {
    settings.start_fullscreen && !args.windowed && !args.smoke
}

/// Record a fullscreen change, so a launch-and-restore round trip brings the window back the way
/// the user left it.
pub fn remember_fullscreen(fullscreen: bool) {
    WAS_FULLSCREEN.store(fullscreen, Ordering::SeqCst);
}

pub fn window_state(win: &WebviewWindow) -> ShellWindowState {
    ShellWindowState {
        fullscreen: win.is_fullscreen().unwrap_or(false),
        maximized: win.is_maximized().unwrap_or(false),
        minimized: win.is_minimized().unwrap_or(false),
    }
}

/// A windowed size proportional to the target monitor rather than a hard-coded 720p, clamped so
/// it is neither unusably small nor larger than the desktop.
///
/// The target monitor is the configured index when it still exists, else whichever one the
/// window is currently on, else the primary - `current_monitor` can be None before the window
/// is mapped.
fn windowed_size(win: &WebviewWindow, monitor_index: Option<u32>) -> LogicalSize<f64> {
    let explicit = match monitor_index {
        Some(idx) => win
            .available_monitors()
            .ok()
            .and_then(|all| all.into_iter().nth(idx as usize)),
        None => None,
    };
    let monitor = explicit
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return LogicalSize::new(WINDOWED_FALLBACK.0, WINDOWED_FALLBACK.1);
    };
    let available = monitor.size().to_logical::<f64>(monitor.scale_factor());
    // min() before max() on purpose: on a display smaller than our minimum the floor has to
    // win, and `clamp` would panic on the inverted range.
    let width = (available.width * WINDOWED_FRACTION)
        .min(WINDOWED_MAX.0)
        .min(available.width)
        .max(WINDOWED_MIN.0);
    let height = (available.height * WINDOWED_FRACTION)
        .min(WINDOWED_MAX.1)
        .min(available.height)
        .max(WINDOWED_MIN.1);
    LogicalSize::new(width, height)
}

/// Apply settings + CLI overrides. The window stays hidden until `reveal` (called by the UI via
/// `shell_ready`) so the user never sees an unstyled frame.
pub fn configure_main_window(
    app: &AppHandle,
    settings: &Settings,
    args: &Args,
) -> tauri::Result<()> {
    let Some(win) = main_window(app) else {
        return Ok(());
    };
    let fullscreen = wants_fullscreen(settings, args);
    WAS_FULLSCREEN.store(fullscreen, Ordering::SeqCst);

    if let Some(idx) = settings.monitor_index {
        if let Some(monitor) = win.available_monitors()?.into_iter().nth(idx as usize) {
            win.set_position(*monitor.position())?;
        }
    }

    win.set_decorations(false)?;
    if fullscreen {
        // Re-asserted in `reveal`: a still-hidden window does not always take the resize.
        win.set_fullscreen(true)?;
        win.set_always_on_top(settings.always_on_top)?;
    } else {
        win.set_fullscreen(false)?;
        win.set_always_on_top(false)?;
        win.set_size(windowed_size(&win, settings.monitor_index))?;
        win.center()?;
    }
    Ok(())
}

/// Enter or leave fullscreen and leave the window in a state that matches.
///
/// One function because several callers need exactly this - the `set_fullscreen` command and a
/// settings change - and they must agree about topmost and about what size the window comes back
/// at. Leaving fullscreen restores the windowed geometry from before it was entered.
pub fn apply_fullscreen(
    win: &WebviewWindow,
    fullscreen: bool,
    always_on_top: bool,
    monitor_index: Option<u32>,
) -> tauri::Result<()> {
    let currently = win.is_fullscreen().unwrap_or(false);
    if fullscreen {
        if !currently && !win.is_maximized().unwrap_or(false) {
            if let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) {
                *LAST_WINDOWED.lock().unwrap_or_else(|e| e.into_inner()) = Some((pos, size));
            }
        }
        win.set_fullscreen(true)?;
    } else if currently {
        win.set_fullscreen(false)?;
        let remembered = *LAST_WINDOWED.lock().unwrap_or_else(|e| e.into_inner());
        match remembered {
            Some((pos, size)) => {
                win.set_size(size)?;
                win.set_position(pos)?;
            }
            None => {
                win.set_size(windowed_size(win, monitor_index))?;
                win.center()?;
            }
        }
    }
    // Topmost only makes sense fullscreen; `configure_main_window` makes the same choice.
    win.set_always_on_top(fullscreen && always_on_top)?;
    remember_fullscreen(fullscreen);
    Ok(())
}

/// Maximise or restore the *windowed* shell - the title bar's middle button.
///
/// Deliberately not fullscreen. Fullscreen is its own setting (Settings, F11) and the title bar
/// is not drawn in fullscreen at all, so the two meanings never share one button. Asked while
/// fullscreen, this changes nothing rather than guessing which of the two was meant.
pub fn toggle_maximize(win: &WebviewWindow) -> tauri::Result<ShellWindowState> {
    if !win.is_fullscreen()? {
        if win.is_maximized()? {
            win.unmaximize()?;
        } else {
            win.maximize()?;
        }
    }
    Ok(window_state(win))
}

/// Show + focus after the UI's first paint.
pub fn reveal(win: &WebviewWindow, fullscreen: bool) -> tauri::Result<()> {
    win.show()?;
    win.set_focus()?;
    // Some Tauri/WebView2 combinations do not resize a hidden window into fullscreen, leaving
    // it at its configured size once shown. Asking again now that it is on screen costs
    // nothing and is the difference between native resolution and a 1080p window on a 4K panel.
    if fullscreen {
        win.set_fullscreen(true)?;
    }
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
/// taskbar so the user can always get back with the mouse - `set_skip_taskbar` is deliberately
/// never called anywhere for that reason.
pub fn hide_for_launch(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let fullscreen = win.is_fullscreen().unwrap_or(false);
        WAS_FULLSCREEN.store(fullscreen, Ordering::SeqCst);
        let _ = win.set_always_on_top(false);
        // Minimising straight out of native fullscreen is a known rough edge on Windows: a
        // borderless window can come out of the state half-applied, and with no decorations
        // there is nothing to click to get it back - which reads as "the shell closed".
        // Leave fullscreen first, then minimise.
        if fullscreen {
            let _ = win.set_fullscreen(false);
        }
        let _ = win.minimize();
    }
}

pub fn restore_after_launch(app: &AppHandle, always_on_top: bool) {
    if let Some(win) = main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        // Re-assert fullscreen from what we remembered rather than trusting `is_fullscreen()`
        // to have survived the minimise; coming back as a small window after a game reads as
        // "Aura quit and something else opened".
        let fullscreen = WAS_FULLSCREEN.load(Ordering::SeqCst);
        if fullscreen {
            let _ = win.set_fullscreen(true);
        }
        // Topmost only makes sense fullscreen; `configure_main_window` makes the same choice.
        let _ = win.set_always_on_top(fullscreen && always_on_top);
        let _ = win.set_focus();
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
