use std::sync::Arc;

use aura_core::Core;

use crate::shell_host::args::Args;

/// Shared with every command via `tauri::State<AppState>`.
pub struct AppState {
    pub core: Arc<Core>,
    pub args: Args,
    pub version: String,
}
