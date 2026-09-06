//! Library service: the joined view of entries + artwork + stats, the manual-add path, and
//! background store scans.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-library agent).
//! Scan flow to implement in `run_scan`:
//!   1. emit ScanProgress{Queued}
//!   2. for each scanner: emit Discovering, `scanner.scan()`, emit Parsing/Saving
//!   3. upsert each DiscoveredEntry (match on (source, source_id); keep the existing id)
//!   4. entries no longer present on disk are NOT deleted in V1 (mark nothing) - just logged
//!   5. emit LibraryUpdated{reason:"scan"} then ScanProgress{Done, done:true}
//!   6. kick `artwork::start_fetch` for every new entry without artwork
//! Scans run on a std thread; `Core` is `Arc`. Errors are emitted as ScanProgress{Error}.

pub mod scanners;
pub mod vdf;

use std::sync::Arc;

use crate::error::Result;
use crate::model::*;
use crate::Core;

/// Join an entry with its artwork and stats.
pub fn hydrate(core: &Core, entry: Entry) -> Result<LibraryItem> {
    let _ = (core, entry);
    todo!("library::hydrate")
}

pub fn list(core: &Core, filter: &EntryFilter) -> Result<Vec<LibraryItem>> {
    let _ = (core, filter);
    todo!("library::list")
}

pub fn get(core: &Core, id: &str) -> Result<Option<LibraryItem>> {
    let _ = (core, id);
    todo!("library::get")
}

/// Validate the executable, build an `Entry` (source = Manual), persist, emit
/// `LibraryUpdated{reason:"manual_add"}` and return it. Artwork fetch is NOT started
/// automatically for manual entries (no store id); the UI offers "Find artwork" instead.
pub fn add_manual(core: &Core, input: AddManualEntryInput) -> Result<LibraryItem> {
    let _ = (core, input);
    todo!("library::add_manual")
}

pub fn update(core: &Core, id: &str, patch: UpdateEntryPatch) -> Result<LibraryItem> {
    let _ = (core, id, patch);
    todo!("library::update")
}

pub fn remove(core: &Core, id: &str) -> Result<()> {
    let _ = (core, id);
    todo!("library::remove")
}

/// Spawn the scan thread and return its job id.
pub fn start_scan(core: Arc<Core>, sources: Vec<Source>) -> String {
    let _ = (core, sources);
    todo!("library::start_scan")
}

/// Persist scanner output. Returns ids of new or changed entries. Public for tests.
pub fn persist_discovered(core: &Core, discovered: &[DiscoveredEntry]) -> Result<Vec<String>> {
    let _ = (core, discovered);
    todo!("library::persist_discovered")
}
