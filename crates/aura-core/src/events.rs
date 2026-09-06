//! Core -> UI event stream. The shell host implements [`EventSink`] by forwarding to Tauri's
//! `app.emit(name, payload)`. Event names are namespaced `service://event` and MUST match
//! `CoreEventName` in `src/bridge/types.ts` and the table in `docs/IPC.md`.

use serde::Serialize;

use crate::model::*;

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum CoreEvent {
    ScanProgress(ScanProgress),
    LibraryUpdated(LibraryUpdated),
    ArtworkUpdated(ArtworkUpdated),
    ProcessStarted(LaunchSession),
    ProcessExited(ProcessExited),
    Gamepad(GamepadEvent),
    ThemeChanged {
        #[serde(rename = "themeId")]
        theme_id: String,
    },
    Toast(Toast),
}

impl CoreEvent {
    /// The wire name used with `emit` / `listen`.
    pub fn name(&self) -> &'static str {
        match self {
            CoreEvent::ScanProgress(_) => "library://scan-progress",
            CoreEvent::LibraryUpdated(_) => "library://updated",
            CoreEvent::ArtworkUpdated(_) => "library://artwork",
            CoreEvent::ProcessStarted(_) => "process://started",
            CoreEvent::ProcessExited(_) => "process://exited",
            CoreEvent::Gamepad(_) => "input://gamepad",
            CoreEvent::ThemeChanged { .. } => "theme://changed",
            CoreEvent::Toast(_) => "shell://toast",
        }
    }
}

pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: CoreEvent);
}

/// Sink that records events in memory - for tests.
#[derive(Default)]
pub struct RecordingSink(pub parking_lot::Mutex<Vec<CoreEvent>>);

impl RecordingSink {
    pub fn take(&self) -> Vec<CoreEvent> {
        std::mem::take(&mut *self.0.lock())
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: CoreEvent) {
        self.0.lock().push(event);
    }
}

/// Sink that drops everything - for headless tooling.
pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _event: CoreEvent) {}
}
