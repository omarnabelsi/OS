//! gilrs event loop -> `GamepadEvent`.
//!
//! Maps gilrs `Button`/`Axis` onto our enums, applies a stick deadzone, and only emits an axis
//! event when the value moves by more than [`AXIS_EPSILON`] or crosses the deadzone. Polls at
//! ~250 Hz and exits when `stop` is set. If gilrs cannot initialise (no XInput, no permission)
//! it logs once and returns - the UI falls back to the browser Gamepad API.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::events::{CoreEvent, EventSink};
use crate::model::{GamepadAxis, GamepadButton, GamepadEvent, GamepadEventKind};

pub const STICK_DEADZONE: f32 = 0.25;
pub const AXIS_EPSILON: f32 = 0.05;

/// ~250 Hz. Fast enough that a D-pad tap is never missed, cheap enough to ignore.
const POLL_INTERVAL: Duration = Duration::from_millis(4);

fn button_event(
    gamepad_id: u32,
    button: GamepadButton,
    value: f32,
    pressed: bool,
    name: Option<String>,
) -> CoreEvent {
    CoreEvent::Gamepad(GamepadEvent {
        gamepad_id,
        kind: GamepadEventKind::Button,
        button: Some(button),
        axis: None,
        value,
        pressed,
        name,
    })
}

fn axis_event(gamepad_id: u32, axis: GamepadAxis, value: f32, name: Option<String>) -> CoreEvent {
    CoreEvent::Gamepad(GamepadEvent {
        gamepad_id,
        kind: GamepadEventKind::Axis,
        button: None,
        axis: Some(axis),
        value,
        pressed: value != 0.0,
        name,
    })
}

fn connection_event(gamepad_id: u32, connected: bool, name: Option<String>) -> CoreEvent {
    CoreEvent::Gamepad(GamepadEvent {
        gamepad_id,
        kind: if connected {
            GamepadEventKind::Connected
        } else {
            GamepadEventKind::Disconnected
        },
        button: None,
        axis: None,
        value: 0.0,
        pressed: false,
        name,
    })
}

pub fn run(sink: Arc<dyn EventSink>, stop: Arc<AtomicBool>) {
    let mut gilrs = match gilrs::Gilrs::new() {
        Ok(g) => g,
        Err(e) => {
            tracing::warn!(
                "gamepad service unavailable ({e}); the UI will fall back to the browser Gamepad API"
            );
            return;
        }
    };

    // Announce pads that were already plugged in before we started listening.
    for (id, pad) in gilrs.gamepads() {
        let gamepad_id = usize::from(id) as u32;
        sink.emit(connection_event(gamepad_id, true, Some(pad.name().to_string())));
    }

    // Last emitted value per (pad, axis), so we can suppress jitter.
    let mut last_axis: HashMap<(u32, GamepadAxis), f32> = HashMap::new();

    while !stop.load(Ordering::SeqCst) {
        while let Some(event) = gilrs.next_event() {
            let gamepad_id = usize::from(event.id) as u32;
            let name = Some(gilrs.gamepad(event.id).name().to_string());

            match event.event {
                gilrs::EventType::Connected => {
                    sink.emit(connection_event(gamepad_id, true, name));
                }
                gilrs::EventType::Disconnected => {
                    last_axis.retain(|(pad, _), _| *pad != gamepad_id);
                    sink.emit(connection_event(gamepad_id, false, name));
                }
                gilrs::EventType::ButtonPressed(button, _) => {
                    if let Some(mapped) = map_button(button) {
                        sink.emit(button_event(gamepad_id, mapped, 1.0, true, name));
                    }
                }
                gilrs::EventType::ButtonReleased(button, _) => {
                    if let Some(mapped) = map_button(button) {
                        sink.emit(button_event(gamepad_id, mapped, 0.0, false, name));
                    }
                }
                // Analog triggers report here; the digital buttons are covered above, so only
                // the two pressure-sensitive ones are forwarded to avoid duplicate events.
                gilrs::EventType::ButtonChanged(button, value, _) => {
                    if matches!(button, gilrs::Button::LeftTrigger2 | gilrs::Button::RightTrigger2)
                    {
                        if let Some(mapped) = map_button(button) {
                            let pressed = value > 0.5;
                            sink.emit(button_event(gamepad_id, mapped, value, pressed, name));
                        }
                    }
                }
                gilrs::EventType::AxisChanged(axis, raw, _) => {
                    let Some(mapped) = map_axis(axis) else { continue };
                    let value = apply_deadzone(raw, STICK_DEADZONE);
                    let key = (gamepad_id, mapped);
                    let previous = last_axis.get(&key).copied().unwrap_or(0.0);

                    // Emit on a real move, or when the stick returns to (or leaves) centre.
                    let crossed_deadzone = (value == 0.0) != (previous == 0.0);
                    if crossed_deadzone || (value - previous).abs() > AXIS_EPSILON {
                        last_axis.insert(key, value);
                        sink.emit(axis_event(gamepad_id, mapped, value, name));
                    }
                }
                _ => {}
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }

    tracing::debug!("gamepad thread stopping");
}

pub fn map_button(b: gilrs::Button) -> Option<GamepadButton> {
    use gilrs::Button as B;
    Some(match b {
        B::South => GamepadButton::South,
        B::East => GamepadButton::East,
        B::North => GamepadButton::North,
        B::West => GamepadButton::West,
        // gilrs calls the bumpers "Trigger" and the analog triggers "Trigger2".
        B::LeftTrigger => GamepadButton::LeftShoulder,
        B::RightTrigger => GamepadButton::RightShoulder,
        B::LeftTrigger2 => GamepadButton::LeftTrigger,
        B::RightTrigger2 => GamepadButton::RightTrigger,
        B::Start => GamepadButton::Start,
        B::Select => GamepadButton::Select,
        B::Mode => GamepadButton::Guide,
        B::LeftThumb => GamepadButton::LeftStick,
        B::RightThumb => GamepadButton::RightStick,
        B::DPadUp => GamepadButton::DpadUp,
        B::DPadDown => GamepadButton::DpadDown,
        B::DPadLeft => GamepadButton::DpadLeft,
        B::DPadRight => GamepadButton::DpadRight,
        _ => return None,
    })
}

pub fn map_axis(a: gilrs::Axis) -> Option<GamepadAxis> {
    use gilrs::Axis as A;
    Some(match a {
        A::LeftStickX => GamepadAxis::LeftX,
        A::LeftStickY => GamepadAxis::LeftY,
        A::RightStickX => GamepadAxis::RightX,
        A::RightStickY => GamepadAxis::RightY,
        _ => return None,
    })
}

/// Apply a deadzone and rescale the remainder to the full -1..1 range, so the first pixel of
/// stick movement past the threshold is not a jump. Public for tests.
pub fn apply_deadzone(v: f32, deadzone: f32) -> f32 {
    if !v.is_finite() {
        return 0.0;
    }
    let deadzone = deadzone.clamp(0.0, 0.999);
    let magnitude = v.abs();
    if magnitude <= deadzone {
        return 0.0;
    }
    let scaled = ((magnitude - deadzone) / (1.0 - deadzone)).min(1.0);
    if v < 0.0 {
        -scaled
    } else {
        scaled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadzone_zeroes_small_input() {
        assert_eq!(apply_deadzone(0.0, 0.25), 0.0);
        assert_eq!(apply_deadzone(0.1, 0.25), 0.0);
        assert_eq!(apply_deadzone(-0.25, 0.25), 0.0);
    }

    #[test]
    fn deadzone_rescales_the_live_range() {
        // Just past the threshold starts near zero, not at 0.25.
        let just_past = apply_deadzone(0.26, 0.25);
        assert!(just_past > 0.0 && just_past < 0.05, "got {just_past}");

        // Full deflection stays full.
        assert!((apply_deadzone(1.0, 0.25) - 1.0).abs() < 1e-6);
        assert!((apply_deadzone(-1.0, 0.25) + 1.0).abs() < 1e-6);

        // Halfway between deadzone and full is halfway in the rescaled range.
        let mid = apply_deadzone(0.625, 0.25);
        assert!((mid - 0.5).abs() < 1e-6, "got {mid}");
    }

    #[test]
    fn deadzone_is_symmetric_and_clamped() {
        for v in [0.3f32, 0.5, 0.9, 1.0] {
            assert!((apply_deadzone(v, 0.25) + apply_deadzone(-v, 0.25)).abs() < 1e-6);
        }
        // Over-range hardware values are clamped rather than amplified.
        assert!((apply_deadzone(1.5, 0.25) - 1.0).abs() < 1e-6);
        assert_eq!(apply_deadzone(f32::NAN, 0.25), 0.0);
        // A zero deadzone is the identity.
        assert!((apply_deadzone(0.4, 0.0) - 0.4).abs() < 1e-6);
    }

    #[test]
    fn buttons_map_to_the_xbox_layout() {
        use gilrs::Button as B;
        assert_eq!(map_button(B::South), Some(GamepadButton::South));
        assert_eq!(map_button(B::West), Some(GamepadButton::West));
        assert_eq!(map_button(B::Mode), Some(GamepadButton::Guide));
        assert_eq!(map_button(B::LeftThumb), Some(GamepadButton::LeftStick));
        assert_eq!(map_button(B::DPadLeft), Some(GamepadButton::DpadLeft));
        // Bumper vs analog trigger is the easy one to get backwards.
        assert_eq!(map_button(B::LeftTrigger), Some(GamepadButton::LeftShoulder));
        assert_eq!(map_button(B::LeftTrigger2), Some(GamepadButton::LeftTrigger));
        assert_eq!(map_button(B::RightTrigger), Some(GamepadButton::RightShoulder));
        assert_eq!(map_button(B::RightTrigger2), Some(GamepadButton::RightTrigger));
        assert_eq!(map_button(B::Unknown), None);
    }

    #[test]
    fn only_the_two_sticks_map_to_axes() {
        use gilrs::Axis as A;
        assert_eq!(map_axis(A::LeftStickX), Some(GamepadAxis::LeftX));
        assert_eq!(map_axis(A::LeftStickY), Some(GamepadAxis::LeftY));
        assert_eq!(map_axis(A::RightStickX), Some(GamepadAxis::RightX));
        assert_eq!(map_axis(A::RightStickY), Some(GamepadAxis::RightY));
        // The D-pad arrives as buttons, not axes, so these are deliberately unmapped.
        assert_eq!(map_axis(A::DPadX), None);
        assert_eq!(map_axis(A::Unknown), None);
    }

    #[test]
    fn stopping_is_immediate_when_already_set() {
        use crate::events::RecordingSink;
        let sink = Arc::new(RecordingSink::default());
        let stop = Arc::new(AtomicBool::new(true));
        // Returns promptly whether or not gilrs initialises on this machine.
        run(sink.clone(), stop);
        assert!(sink.take().iter().all(|e| matches!(e, CoreEvent::Gamepad(_))));
    }
}
