//! Manual add: the user browses to an `.exe` (or `.lnk`, `.url`, `.bat`) and we build an entry.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-library agent).
//! Rules: path must exist and be a file; `.lnk` is stored as `LaunchSpec::Shell{target}` so
//! Windows resolves it; `.url` likewise; everything else is `LaunchSpec::Exe` with
//! `cwd = parent dir`. Name defaults to a prettified file stem ("my_game-x64" -> "My Game").

use crate::error::Result;
use crate::model::{AddManualEntryInput, DiscoveredEntry};

pub fn discover(input: &AddManualEntryInput) -> Result<DiscoveredEntry> {
    let _ = input;
    todo!("library::scanners::manual::discover")
}

/// "elden_ring-x64.exe" -> "Elden Ring". Public for tests.
pub fn prettify_name(file_stem: &str) -> String {
    let _ = file_stem;
    todo!("library::scanners::manual::prettify_name")
}
