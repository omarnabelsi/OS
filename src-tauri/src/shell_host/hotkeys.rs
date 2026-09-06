//! Global hotkeys. V1 has exactly one: the exit hotkey, which must work even when a game has
//! focus, because "the user can leave at any moment with one hotkey" is a core principle.

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register_exit_hotkey(app: &AppHandle, accelerator: &str) -> anyhow::Result<()> {
    let gs = app.global_shortcut();
    if gs.is_registered(accelerator) {
        gs.unregister(accelerator)?;
    }
    gs.on_shortcut(accelerator, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            log::info!("exit hotkey pressed");
            let _ = app.emit("shell://hotkey", serde_json::json!({ "action": "exit" }));
            if let Some(state) = app.try_state::<crate::state::AppState>() {
                state.core.stop_input();
            }
            app.exit(0);
        }
    })?;
    Ok(())
}
