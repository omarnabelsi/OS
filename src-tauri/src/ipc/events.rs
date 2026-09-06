//! Forward `CoreEvent`s to the webview. `CoreEvent` is `#[serde(untagged)]`, so the payload the
//! UI receives is the inner struct itself (e.g. `ScanProgress`), under the event's wire name.

use aura_core::{CoreEvent, EventSink};
use tauri::{AppHandle, Emitter};

pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: CoreEvent) {
        let name = event.name();
        if let Err(e) = self.app.emit(name, &event) {
            log::warn!("failed to emit {name}: {e}");
        }
    }
}
