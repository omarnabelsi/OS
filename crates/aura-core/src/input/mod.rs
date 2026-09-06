//! Input service. Runs one gilrs polling thread and emits normalised `input://gamepad` events.
//! The UI turns them into focus moves; the UI also listens to the browser Gamepad API as a
//! fallback so either path works.

pub mod gamepad;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::events::EventSink;

/// Spawn the gamepad thread. Returns immediately.
pub fn start(sink: Arc<dyn EventSink>, stop: Arc<AtomicBool>) {
    std::thread::Builder::new()
        .name("aura-gamepad".into())
        .spawn(move || gamepad::run(sink, stop))
        .expect("spawn gamepad thread");
}
