//! Shell host (Layer 1): window and monitor management, global hotkeys, single-instance guard,
//! crash watchdog and auto-recovery. V1 runs in *Overlay Mode* only - Explorer keeps running and
//! is never hidden. Desktop/taskbar hiding and shell registration are V2 and will live here.

pub mod args;
pub mod hotkeys;
pub mod monitors;
pub mod watchdog;
pub mod window;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Where the bundled themes live. In a packaged build that is `<resources>/themes`; during
/// `tauri dev` the resource dir is the crate dir, so fall back to the repo's `themes/` folder.
pub fn resolve_bundled_themes_dir(app: &AppHandle) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let packaged = res.join("themes");
        if packaged.join("aura-default").join("manifest.json").exists() {
            return packaged;
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("themes");
    if dev.exists() {
        return dev;
    }
    PathBuf::from("themes")
}
