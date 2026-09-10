//! System service.
//!
//! V1 reads only what the taskbar's system area actually shows and what Windows will hand over
//! for free: the power state. Volume (Core Audio), Wi-Fi / Bluetooth (WinRT Radios) and the
//! power menu (`SetSuspendState` / `ExitWindowsEx`) remain V2 - they are all *write* surfaces,
//! and this shell does not take control of the machine (docs/RISKS.md R13).
//!
//! The clock is deliberately not here. It is `new Date()` in the UI: a round trip per second to
//! learn the time the webview already knows would be absurd.

use serde::{Deserialize, Serialize};

use crate::error::CoreError;

pub fn not_implemented(what: &str) -> CoreError {
    CoreError::Unsupported(format!("system::{what} is planned for V2"))
}

/// What the taskbar's system area can show. Every field is optional because a desktop PC has no
/// battery at all, and "unknown" must be distinguishable from "flat".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    /// 0..=100, or None on a machine with no battery.
    pub battery_percent: Option<u8>,
    pub charging: bool,
    /// True when a battery is present at all - a desktop shows no battery indicator.
    pub has_battery: bool,
}

#[cfg(windows)]
mod ffi {
    /// `SYSTEM_POWER_STATUS` from winbase.h.
    #[repr(C)]
    #[derive(Default)]
    pub struct SystemPowerStatus {
        pub ac_line_status: u8,
        pub battery_flag: u8,
        pub battery_life_percent: u8,
        pub system_status_flag: u8,
        pub battery_life_time: u32,
        pub battery_full_life_time: u32,
    }

    // Raw FFI rather than the `windows` crate, matching the convention set by `process/tree.rs`.
    unsafe extern "system" {
        pub fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }
}

/// Read the power state.
///
/// Never fails: a system area that cannot be drawn because a status read errored would be a
/// worse outcome than showing nothing, so an unavailable reading is simply absent.
#[cfg(windows)]
pub fn status() -> SystemStatus {
    // 255 in either field means "unknown", which Windows returns on some virtual machines.
    const UNKNOWN: u8 = 255;
    const NO_BATTERY: u8 = 128;
    const AC_ONLINE: u8 = 1;

    let mut raw = ffi::SystemPowerStatus::default();
    // SAFETY: a call into Win32 with a pointer to a stack value of exactly the layout the API
    // documents. It only writes through the pointer, and only on success.
    let ok = unsafe { ffi::GetSystemPowerStatus(&mut raw) } != 0;
    if !ok {
        return SystemStatus::default();
    }

    let has_battery = raw.battery_flag != NO_BATTERY && raw.battery_flag != UNKNOWN;
    SystemStatus {
        battery_percent: if has_battery && raw.battery_life_percent <= 100 {
            Some(raw.battery_life_percent)
        } else {
            None
        },
        charging: raw.ac_line_status == AC_ONLINE,
        has_battery,
    }
}

/// Non-Windows builds exist only so `cargo test` runs on a developer's other machine.
#[cfg(not(windows))]
pub fn status() -> SystemStatus {
    SystemStatus::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_the_power_state_never_panics_or_errors() {
        // Runs on CI hardware, on a laptop and in a VM; all three must return something usable.
        let s = status();
        if let Some(pct) = s.battery_percent {
            assert!(pct <= 100, "battery percent out of range: {pct}");
            assert!(s.has_battery, "a percentage implies a battery");
        }
    }

    #[test]
    fn a_machine_with_no_battery_reports_none_rather_than_zero() {
        // The distinction the taskbar depends on: `has_battery == false` hides the indicator,
        // where a `0` would draw an empty battery on a desktop PC.
        let none = SystemStatus::default();
        assert!(!none.has_battery);
        assert_eq!(none.battery_percent, None);
    }
}
