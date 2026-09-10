//! Global hotkeys. V1 has exactly one: the exit hotkey, which must work even when a game has
//! focus, because "the user can leave at any moment with one hotkey" is a core principle.
//!
//! Two rules follow from that, and both used to be broken:
//!   - a failed registration is reported, never swallowed - a key the user believes in but which
//!     does nothing is worse than no key at all;
//!   - a rebind never leaves the shell with no binding, so the new accelerator is claimed before
//!     the old one is released.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// What the OS has actually given us, as opposed to what settings ask for.
///
/// Process-global because a global shortcut is: it is registered per process, not per window.
/// Tracking it is what lets a rebind release the *previous* accelerator - `register` alone only
/// ever knew about the new one, so repeated changes leaked the old bindings.
static STATE: Mutex<HotkeyState> = Mutex::new(HotkeyState::new());

struct HotkeyState {
    registered: Option<String>,
    error: Option<String>,
}

impl HotkeyState {
    const fn new() -> Self {
        Self { registered: None, error: None }
    }
}

fn state() -> std::sync::MutexGuard<'static, HotkeyState> {
    // A panic elsewhere must not make the escape hatch unusable, so poisoning is ignored.
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether the exit hotkey is really armed, for the UI to show honestly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitHotkeyStatus {
    /// The accelerator settings ask for.
    pub accelerator: String,
    /// True only when that exact accelerator is currently claimed from the OS.
    pub registered: bool,
    /// Why the last attempt failed, when it did.
    pub error: Option<String>,
}

/// Claim `accelerator`, releasing whatever we held before.
///
/// The new binding is registered *first*: if it fails, the previous one was never released and
/// keeps working, so a bad rebind degrades to "nothing changed" instead of "no way out".
pub fn bind_exit_hotkey(app: &AppHandle, accelerator: &str) -> anyhow::Result<()> {
    let previous = state().registered.clone();

    match claim(app, accelerator) {
        Ok(()) => {
            if let Some(old) = previous.as_deref() {
                if old != accelerator {
                    let _ = app.global_shortcut().unregister(old);
                }
            }
            let mut s = state();
            s.registered = Some(accelerator.to_string());
            s.error = None;
            log::info!("exit hotkey `{accelerator}` registered");
            Ok(())
        }
        Err(e) => {
            state().error = Some(e.to_string());
            Err(e)
        }
    }
}

fn claim(app: &AppHandle, accelerator: &str) -> anyhow::Result<()> {
    let gs = app.global_shortcut();
    if gs.is_registered(accelerator) {
        gs.unregister(accelerator)?;
    }
    gs.on_shortcut(accelerator, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            log::info!("exit hotkey pressed");
            let _ = app.emit("shell://hotkey", serde_json::json!({ "action": "exit" }));
            if let Some(state) = app.try_state::<crate::state::AppState>() {
                // Stop the gilrs thread before the process goes, so it does not outlive us.
                state.core.stop_input();
            }
            app.exit(0);
        }
    })?;
    Ok(())
}

/// Current state, paired with the accelerator settings currently ask for.
pub fn status(wanted: &str) -> ExitHotkeyStatus {
    let s = state();
    ExitHotkeyStatus {
        accelerator: wanted.to_string(),
        registered: s.registered.as_deref() == Some(wanted),
        error: s.error.clone(),
    }
}
