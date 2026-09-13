//! Tauri commands. Keep these thin: validate nothing here, delegate to `Core`, and let
//! `CoreError` serialise as `{ code, message }`. Argument names are snake_case in Rust and
//! camelCase on the JS side (Tauri converts).

use aura_core::*;
use tauri::{AppHandle, State, WebviewWindow};

use crate::shell_host;
use crate::state::AppState;

type CmdResult<T> = std::result::Result<T, CoreError>;

// ---- app --------------------------------------------------------------------------------------

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppInfo {
    state.core.app_info(&state.version, state.args.smoke)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.core.settings()
}

/// Apply a settings patch, and keep the OS in step with it.
///
/// Changing `exitHotkey` used to change only the stored string and the label in Settings, while
/// the real global shortcut stayed whatever was claimed at boot. It is re-registered here.
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> CmdResult<Settings> {
    let previous = state.core.settings();
    let next = state.core.update_settings(patch)?;

    if next.exit_hotkey != previous.exit_hotkey {
        if let Err(e) = shell_host::hotkeys::bind_exit_hotkey(&app, &next.exit_hotkey) {
            // The old accelerator is still claimed - `bind_exit_hotkey` registers before it
            // releases - so put the stored value back to match, and let the UI say why. Ending
            // up with a stored hotkey that nothing listens to is the failure we are avoiding.
            let restore = serde_json::json!({ "exitHotkey": previous.exit_hotkey });
            if let Err(e) = state.core.update_settings(restore) {
                log::error!("could not restore the previous exit hotkey: {e}");
            }
            return Err(CoreError::Invalid(format!(
                "`{}` could not be registered ({e}) - keeping `{}`",
                next.exit_hotkey, previous.exit_hotkey
            )));
        }
    }

    // `startFullscreen` is the fullscreen preference, and changing it in Settings applies it
    // now: a toggle that only took effect at the next start read as broken. Never in a smoke
    // run, which is windowed by definition.
    if next.start_fullscreen != previous.start_fullscreen && !state.args.smoke {
        if let Some(win) = shell_host::window::main_window(&app) {
            if let Err(e) = shell_host::window::apply_fullscreen(
                &win,
                next.start_fullscreen,
                next.always_on_top,
                next.monitor_index,
            ) {
                log::warn!(
                    "could not apply fullscreen = {}: {e}",
                    next.start_fullscreen
                );
            }
        }
    }

    Ok(next)
}

/// Whether the exit hotkey is actually armed. The UI checks this on startup and in Settings.
#[tauri::command]
pub fn get_exit_hotkey_status(state: State<'_, AppState>) -> shell_host::hotkeys::ExitHotkeyStatus {
    shell_host::hotkeys::status(&state.core.settings().exit_hotkey)
}

// ---- library ----------------------------------------------------------------------------------

#[tauri::command]
pub fn list_entries(
    state: State<'_, AppState>,
    filter: Option<EntryFilter>,
) -> CmdResult<Vec<LibraryItem>> {
    state.core.list_entries(filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_entry(state: State<'_, AppState>, id: String) -> CmdResult<Option<LibraryItem>> {
    state.core.get_entry(&id)
}

#[tauri::command]
pub fn add_manual_entry(
    state: State<'_, AppState>,
    input: AddManualEntryInput,
) -> CmdResult<LibraryItem> {
    state.core.add_manual_entry(input)
}

#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateEntryPatch,
) -> CmdResult<LibraryItem> {
    state.core.update_entry(&id, patch)
}

#[tauri::command]
pub fn remove_entry(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.core.remove_entry(&id)
}

/// Returns the job id; progress arrives via `library://scan-progress`.
#[tauri::command]
pub fn scan_library(state: State<'_, AppState>, sources: Option<Vec<Source>>) -> String {
    let sources = sources.unwrap_or_else(aura_core::library::scanners::supported_sources);
    state.core.scan_library(sources)
}

// ---- artwork ----------------------------------------------------------------------------------

#[tauri::command]
pub fn fetch_artwork(state: State<'_, AppState>, entry_id: String, force: Option<bool>) {
    state.core.fetch_artwork(entry_id, force.unwrap_or(false))
}

#[tauri::command]
pub fn set_artwork_override(
    state: State<'_, AppState>,
    entry_id: String,
    kind: ArtworkKind,
    path: String,
) -> CmdResult<Artwork> {
    state.core.set_artwork_override(&entry_id, kind, &path)
}

// ---- process ----------------------------------------------------------------------------------

#[tauri::command]
pub fn launch_entry(state: State<'_, AppState>, id: String) -> CmdResult<LaunchSession> {
    state.core.launch_entry(&id)
}

#[tauri::command]
pub fn active_sessions(state: State<'_, AppState>) -> Vec<LaunchSession> {
    state.core.process.active_sessions()
}

// ---- desktop ----------------------------------------------------------------------------------
//
// Positions are grid cells, not pixels. Live window geometry is UI state and never comes through
// here; only `folders.window_state`, written when a window settles, is persisted.

#[tauri::command]
pub fn list_desktops(state: State<'_, AppState>) -> CmdResult<Vec<Desktop>> {
    state.core.list_desktops()
}

#[tauri::command]
pub fn get_desktop(state: State<'_, AppState>, id: String) -> CmdResult<Option<Desktop>> {
    state.core.get_desktop(&id)
}

#[tauri::command]
pub fn create_desktop(state: State<'_, AppState>, name: String) -> CmdResult<Desktop> {
    state.core.create_desktop(&name)
}

#[tauri::command]
pub fn update_desktop(state: State<'_, AppState>, desktop: Desktop) -> CmdResult<Desktop> {
    state.core.update_desktop(&desktop)
}

#[tauri::command]
pub fn delete_desktop(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.core.delete_desktop(&id)
}

#[tauri::command]
pub fn list_desktop_items(
    state: State<'_, AppState>,
    desktop_id: String,
) -> CmdResult<Vec<DesktopItem>> {
    state.core.list_desktop_items(&desktop_id)
}

#[tauri::command]
pub fn add_desktop_item(
    state: State<'_, AppState>,
    input: NewDesktopItem,
) -> CmdResult<DesktopItem> {
    state.core.add_desktop_item(input)
}

/// Absent fields are left alone, so a drop sends `{ x, y }` and nothing else.
#[tauri::command]
pub fn update_desktop_item(
    state: State<'_, AppState>,
    id: String,
    patch: DesktopItemPatch,
) -> CmdResult<DesktopItem> {
    state.core.update_desktop_item(&id, patch)
}

#[tauri::command]
pub fn remove_desktop_item(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.core.remove_desktop_item(&id)
}

// ---- folders ----------------------------------------------------------------------------------

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> CmdResult<Vec<Folder>> {
    state.core.list_folders()
}

#[tauri::command]
pub fn get_folder(state: State<'_, AppState>, id: String) -> CmdResult<Option<Folder>> {
    state.core.get_folder(&id)
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, input: NewFolder) -> CmdResult<Folder> {
    state.core.create_folder(input)
}

#[tauri::command]
pub fn update_folder(
    state: State<'_, AppState>,
    id: String,
    patch: FolderPatch,
) -> CmdResult<Folder> {
    state.core.update_folder(&id, patch)
}

/// Copy a user-chosen image into the artwork cache and set it as the folder's cover.
///
/// The stored path is the cached copy, not the file the user picked, so the cover survives the
/// original being moved or deleted - and stays inside the asset scope the webview can load from.
#[tauri::command]
pub fn set_folder_cover(state: State<'_, AppState>, id: String, path: String) -> CmdResult<Folder> {
    state.core.set_folder_cover(&id, &path)
}

#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.core.delete_folder(&id)
}

/// What is inside a folder: a smart filter's results, a collection's members, or an empty list
/// for a filesystem folder until the V2 browser lands.
#[tauri::command]
pub fn folder_contents(state: State<'_, AppState>, id: String) -> CmdResult<Vec<LibraryItem>> {
    state.core.folder_contents(&id)
}

// ---- taskbar ----------------------------------------------------------------------------------

/// Pinned and structural items only. "Running" is derived in the UI from open windows and
/// `active_sessions`, so it can never be stale.
#[tauri::command]
pub fn list_taskbar_items(state: State<'_, AppState>) -> CmdResult<Vec<TaskbarItem>> {
    state.core.list_taskbar_items()
}

#[tauri::command]
pub fn pin_to_taskbar(state: State<'_, AppState>, target_id: String) -> CmdResult<TaskbarItem> {
    state.core.pin_to_taskbar(&target_id)
}

#[tauri::command]
pub fn unpin_from_taskbar(state: State<'_, AppState>, target_id: String) -> CmdResult<()> {
    state.core.unpin_from_taskbar(&target_id)
}

#[tauri::command]
pub fn reorder_taskbar(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<()> {
    state.core.reorder_taskbar(ids)
}

/// The power state behind the taskbar's system area. Polled by the UI; deliberately cheap.
///
/// Returns a value rather than a `Result`: there is no failure a caller could act on, and a
/// system area that vanished because a status read errored would be worse than one showing
/// nothing.
#[tauri::command]
pub fn get_system_status(state: State<'_, AppState>) -> SystemStatus {
    state.core.system_status()
}

// ---- themes -----------------------------------------------------------------------------------

#[tauri::command]
pub fn list_themes(state: State<'_, AppState>) -> CmdResult<Vec<ThemeInfo>> {
    state.core.list_themes()
}

/// `id = None` loads the active theme from settings.
#[tauri::command]
pub fn get_theme(state: State<'_, AppState>, id: Option<String>) -> CmdResult<ThemeBundle> {
    let id = id.unwrap_or_else(|| state.core.settings().theme_id);
    state.core.get_theme(&id)
}

#[tauri::command]
pub fn set_active_theme(state: State<'_, AppState>, id: String) -> CmdResult<ThemeBundle> {
    state.core.set_active_theme(&id)
}

// ---- shell host -------------------------------------------------------------------------------

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> CmdResult<Vec<MonitorInfo>> {
    shell_host::monitors::list(&app).map_err(|e| CoreError::Other(e.to_string()))
}

/// Enter or leave fullscreen, and remember the choice.
///
/// Persisted as `startFullscreen`, because this is the user deciding how the shell should be,
/// not a one-off: it used to change only the live window, so an F11 was forgotten at the next
/// start. A `--smoke` run never writes it - CI must not change anyone's preference.
#[tauri::command]
pub fn set_fullscreen(
    window: WebviewWindow,
    state: State<'_, AppState>,
    fullscreen: bool,
) -> CmdResult<()> {
    let settings = state.core.settings();
    shell_host::window::apply_fullscreen(
        &window,
        fullscreen,
        settings.always_on_top,
        settings.monitor_index,
    )
    .map_err(|e| CoreError::Other(e.to_string()))?;
    if !state.args.smoke && settings.start_fullscreen != fullscreen {
        state
            .core
            .update_settings(serde_json::json!({ "startFullscreen": fullscreen }))?;
    }
    Ok(())
}

/// The native window's state, for the shell's title bar: drawn only when not fullscreen, and
/// showing "restore" rather than "maximise" while maximised.
#[tauri::command]
pub fn get_window_state(window: WebviewWindow) -> shell_host::window::ShellWindowState {
    shell_host::window::window_state(&window)
}

/// Maximise or restore the windowed shell. Never fullscreen - see
/// `shell_host::window::toggle_maximize` for why the two do not share a button.
#[tauri::command]
pub fn toggle_maximize_shell(
    window: WebviewWindow,
) -> CmdResult<shell_host::window::ShellWindowState> {
    shell_host::window::toggle_maximize(&window).map_err(|e| CoreError::Other(e.to_string()))
}

/// The UI calls this once its first frame is painted; the window is created hidden to avoid a
/// white flash and is shown here. Fullscreen is re-asserted at the same time, because a hidden
/// window does not reliably take the resize.
#[tauri::command]
pub fn shell_ready(window: WebviewWindow, state: State<'_, AppState>) -> CmdResult<()> {
    let fullscreen = shell_host::window::wants_fullscreen(&state.core.settings(), &state.args);
    shell_host::window::reveal(&window, fullscreen).map_err(|e| CoreError::Other(e.to_string()))
}

#[tauri::command]
pub fn exit_shell(app: AppHandle, state: State<'_, AppState>) {
    state.core.stop_input();
    app.exit(0);
}

#[tauri::command]
pub fn minimize_shell(window: WebviewWindow) -> CmdResult<()> {
    window
        .minimize()
        .map_err(|e| CoreError::Other(e.to_string()))
}
