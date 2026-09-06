//! Steam scanner.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-library agent).
//!
//! Algorithm:
//!   1. `detect()`: Steam root from `HKCU\Software\Valve\Steam\SteamPath` (winreg), falling back
//!      to `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath`, then `C:\Program Files (x86)\Steam`.
//!   2. `library_folders(root)`: parse `<root>/steamapps/libraryfolders.vdf`; each numbered
//!      child has a `path`. Always include `<root>` itself. De-duplicate.
//!   3. For each library `<lib>/steamapps/appmanifest_*.acf`: `parse_app_manifest`.
//!   4. Skip non-games: appid 228980 (Steamworks Common Redistributables), names containing
//!      "Redistributable", "Proton", "Steam Linux Runtime", "Steamworks", and any manifest whose
//!      `StateFlags` does not include 4 (fully installed).
//!   5. launch = `LaunchSpec::Uri { uri: "steam://rungameid/<appid>" }`,
//!      install_path = `<lib>/steamapps/common/<installdir>`, install_size = `SizeOnDisk`.

use std::path::{Path, PathBuf};

use super::Scanner;
use crate::error::Result;
use crate::model::{DiscoveredEntry, Source};

pub struct SteamScanner {
    pub root: PathBuf,
}

impl SteamScanner {
    /// Locate the Steam installation, if any.
    pub fn detect() -> Option<SteamScanner> {
        find_steam_root().map(|root| SteamScanner { root })
    }

    pub fn with_root(root: PathBuf) -> SteamScanner {
        SteamScanner { root }
    }
}

impl Scanner for SteamScanner {
    fn source(&self) -> Source {
        Source::Steam
    }

    fn scan(&self) -> Result<Vec<DiscoveredEntry>> {
        scan_root(&self.root)
    }
}

/// Registry / default-location lookup. Returns None when Steam is not installed.
pub fn find_steam_root() -> Option<PathBuf> {
    todo!("library::scanners::steam::find_steam_root")
}

/// All library folders (including the root) that currently exist on disk.
pub fn library_folders(root: &Path) -> Result<Vec<PathBuf>> {
    let _ = root;
    todo!("library::scanners::steam::library_folders")
}

/// Parse one `appmanifest_<appid>.acf`. Returns None for non-game / incomplete manifests.
pub fn parse_app_manifest(steamapps_dir: &Path, manifest_path: &Path) -> Result<Option<DiscoveredEntry>> {
    let _ = (steamapps_dir, manifest_path);
    todo!("library::scanners::steam::parse_app_manifest")
}

/// Full scan of one Steam root. Pure function of the filesystem - testable with fixtures.
pub fn scan_root(root: &Path) -> Result<Vec<DiscoveredEntry>> {
    let _ = root;
    todo!("library::scanners::steam::scan_root")
}

/// Whether an appid/name pair is a tool rather than a game.
pub fn is_tool(appid: &str, name: &str) -> bool {
    let _ = (appid, name);
    todo!("library::scanners::steam::is_tool")
}
