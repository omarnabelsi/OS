//! gilrs event loop -> `GamepadEvent`.
//!
//! STATUS: stub - signatures are fixed, body to be implemented (owner: core-input-theme agent).
//! Requirements: map gilrs `Button`/`Axis` to our enums (`map_button`, `map_axis`), apply a
//! stick deadzone (0.25) and only emit an axis event when the value changes by > 0.05 or crosses
//! the deadzone; emit Connected/Disconnected with the pad name; poll at ~250 Hz with
//! `std::thread::sleep(4ms)`; exit when `stop` is set. If gilrs fails to initialise (no XInput),
//! log once and return - the UI falls back to the browser Gamepad API.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::events::EventSink;
use crate::model::{GamepadAxis, GamepadButton};

pub const STICK_DEADZONE: f32 = 0.25;
pub const AXIS_EPSILON: f32 = 0.05;

pub fn run(sink: Arc<dyn EventSink>, stop: Arc<AtomicBool>) {
    let _ = (sink, stop);
    todo!("input::gamepad::run")
}

pub fn map_button(b: gilrs::Button) -> Option<GamepadButton> {
    let _ = b;
    todo!("input::gamepad::map_button")
}

pub fn map_axis(a: gilrs::Axis) -> Option<GamepadAxis> {
    let _ = a;
    todo!("input::gamepad::map_axis")
}

/// Apply a radial deadzone and rescale to -1..1. Public for tests.
pub fn apply_deadzone(v: f32, deadzone: f32) -> f32 {
    let _ = (v, deadzone);
    todo!("input::gamepad::apply_deadzone")
}
