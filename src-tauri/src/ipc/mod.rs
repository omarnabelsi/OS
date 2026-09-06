//! IPC bridge (Layer 3): the only door between the UI and the native world.
//!
//! - `commands` : request/response, one thin `#[tauri::command]` per `Core` method.
//! - `events`   : the `EventSink` that forwards `CoreEvent`s to the webview.
//!
//! Contract: `docs/IPC.md`, mirrored in `src/bridge/types.ts`.

pub mod commands;
pub mod events;
