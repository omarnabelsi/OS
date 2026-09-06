//! System service - V2. Volume (Windows Core Audio), Wi-Fi / Bluetooth (WinRT Radios), battery,
//! power menu (SetSuspendState / ExitWindowsEx). Nothing here is wired to IPC in V1; the module
//! exists so the layer boundary is visible and so V2 work has a home.

use crate::error::CoreError;

pub fn not_implemented(what: &str) -> CoreError {
    CoreError::Unsupported(format!("system::{what} is planned for V2"))
}
