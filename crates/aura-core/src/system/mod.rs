//! System service.
//!
//! V1 reads only what the taskbar's system area actually shows and what Windows will hand over
//! for free: the power state. Volume (Core Audio), Wi-Fi / Bluetooth (WinRT Radios) and the
//! power menu (`SetSuspendState` / `ExitWindowsEx`) remain V2 - they are all *write* surfaces,
//! and this shell does not take control of the machine (docs/RISKS.md R13).
//!
//! The clock *is* here, but as an anchor rather than a tick. A round trip per second to learn the
//! time would be absurd, so the host reports the instant and the zone it is in, and the UI
//! advances its own display from a monotonic clock between reads and re-anchors on each one. The
//! host stays the source of truth - including which timezone the machine is in, which a webview
//! can only guess at - and nothing asks it more often than the status area already polls.

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
    /// The host's wall clock, in milliseconds since the Unix epoch.
    pub epoch_ms: i64,
    /// Minutes to add to UTC to get the host's local time; negative west of Greenwich.
    ///
    /// Sent because the point of taking the clock from the host is that the *host* decides what
    /// time it is. A webview infers its zone from the same machine, so this usually agrees - but
    /// when it does not, the shell should show what Windows shows.
    pub utc_offset_minutes: i32,
}

/// Milliseconds since the Unix epoch. Zero if the system clock is set before 1970.
fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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

    /// `SYSTEMTIME` from minwinbase.h. Only its size and alignment matter here.
    #[repr(C)]
    #[derive(Default)]
    pub struct SystemTime {
        pub year: u16,
        pub month: u16,
        pub day_of_week: u16,
        pub day: u16,
        pub hour: u16,
        pub minute: u16,
        pub second: u16,
        pub milliseconds: u16,
    }

    /// `TIME_ZONE_INFORMATION` from timezoneapi.h.
    #[repr(C)]
    #[derive(Default)]
    pub struct TimeZoneInformation {
        pub bias: i32,
        pub standard_name: [u16; 32],
        pub standard_date: SystemTime,
        pub standard_bias: i32,
        pub daylight_name: [u16; 32],
        pub daylight_date: SystemTime,
        pub daylight_bias: i32,
    }

    pub const TIME_ZONE_ID_INVALID: u32 = u32::MAX;
    pub const TIME_ZONE_ID_STANDARD: u32 = 1;
    pub const TIME_ZONE_ID_DAYLIGHT: u32 = 2;

    // Raw FFI rather than the `windows` crate, matching the convention set by `process/tree.rs`.
    unsafe extern "system" {
        pub fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
        pub fn GetTimeZoneInformation(info: *mut TimeZoneInformation) -> u32;
    }
}

/// The machine's current offset from UTC, in minutes.
///
/// Windows reports a *bias* to subtract (`UTC = local + bias`), plus a seasonal adjustment that
/// only applies in the season the machine is currently in - so the sign flips here and the right
/// one of the two seasonal biases is added.
#[cfg(windows)]
fn utc_offset_minutes() -> i32 {
    let mut info = ffi::TimeZoneInformation::default();
    // SAFETY: a call into Win32 with a pointer to a stack value of exactly the documented
    // layout. It only writes through the pointer, and only on success.
    let id = unsafe { ffi::GetTimeZoneInformation(&mut info) };
    if id == ffi::TIME_ZONE_ID_INVALID {
        return 0;
    }
    let seasonal = match id {
        ffi::TIME_ZONE_ID_DAYLIGHT => info.daylight_bias,
        ffi::TIME_ZONE_ID_STANDARD => info.standard_bias,
        // TIME_ZONE_ID_UNKNOWN: the zone has no DST rules, so the base bias is the whole story.
        _ => 0,
    };
    -(info.bias + seasonal)
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

    // The clock is read whatever the power call does: a machine with no battery still has a time.
    let clock = SystemStatus {
        epoch_ms: epoch_ms(),
        utc_offset_minutes: utc_offset_minutes(),
        ..SystemStatus::default()
    };

    let mut raw = ffi::SystemPowerStatus::default();
    // SAFETY: a call into Win32 with a pointer to a stack value of exactly the layout the API
    // documents. It only writes through the pointer, and only on success.
    let ok = unsafe { ffi::GetSystemPowerStatus(&mut raw) } != 0;
    if !ok {
        return clock;
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
        ..clock
    }
}

/// Non-Windows builds exist only so `cargo test` runs on a developer's other machine.
///
/// The clock is still real - it is plain `std` - but the offset is reported as UTC rather than
/// shelling out to `localtime`, because nothing ships on these platforms.
#[cfg(not(windows))]
pub fn status() -> SystemStatus {
    SystemStatus {
        epoch_ms: epoch_ms(),
        ..SystemStatus::default()
    }
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
    fn the_clock_is_reported_and_plausible() {
        let s = status();
        // Some time after this code was written, and not centuries from now - enough to catch a
        // unit mix-up (seconds for milliseconds) or an uninitialised field.
        assert!(
            s.epoch_ms > 1_750_000_000_000,
            "epoch_ms too small: {}",
            s.epoch_ms
        );
        assert!(
            s.epoch_ms < 4_000_000_000_000,
            "epoch_ms too large: {}",
            s.epoch_ms
        );
    }

    #[test]
    fn the_utc_offset_is_a_real_timezone() {
        // Earth's inhabited offsets run from -12:00 to +14:00, and all of them are whole minutes.
        let offset = status().utc_offset_minutes;
        assert!(
            (-12 * 60..=14 * 60).contains(&offset),
            "implausible UTC offset: {offset}"
        );
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
