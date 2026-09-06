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

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, patch: serde_json::Value) -> CmdResult<Settings> {
    state.core.update_settings(patch)
}

// ---- library ----------------------------------------------------------------------------------

#[tauri::command]
pub fn list_entries(state: State<'_, AppState>, filter: Option<EntryFilter>) -> CmdResult<Vec<LibraryItem>> {
    state.core.list_entries(filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_entry(state: State<'_, AppState>, id: String) -> CmdResult<Option<LibraryItem>> {
    state.core.get_entry(&id)
}

#[tauri::command]
pub fn add_manual_entry(state: State<'_, AppState>, input: AddManualEntryInput) -> CmdResult<LibraryItem> {
    state.core.add_manual_entry(input)
}

#[tauri::command]
pub fn update_entry(state: State<'_, AppState>, id: String, patch: UpdateEntryPatch) -> CmdResult<LibraryItem> {
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

#[tauri::command]
pub fn set_fullscreen(window: WebviewWindow, fullscreen: bool) -> CmdResult<()> {
    window.set_fullscreen(fullscreen).map_err(|e| CoreError::Other(e.to_string()))
}

/// The UI calls this once its first frame is painted; the window is created hidden to avoid a
/// white flash and is shown here.
#[tauri::command]
pub fn shell_ready(window: WebviewWindow) -> CmdResult<()> {
    shell_host::window::reveal(&window).map_err(|e| CoreError::Other(e.to_string()))
}

#[tauri::command]
pub fn exit_shell(app: AppHandle, state: State<'_, AppState>) {
    state.core.stop_input();
    app.exit(0);
}

#[tauri::command]
pub fn minimize_shell(window: WebviewWindow) -> CmdResult<()> {
    window.minimize().map_err(|e| CoreError::Other(e.to_string()))
}
