//! Artwork pipeline: SteamGridDB (when an API key is set) -> Steam CDN (for Steam entries) ->
//! local cache -> `artwork` table -> `library://artwork` events.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-artwork agent).
//! Rules:
//!   - Never overwrite a `user_override` row unless `force`.
//!   - Fetch grid, hero, logo, icon independently; a missing logo is not an error.
//!   - Cache path via `cache::cache_path`; skip download if the file exists and !force.
//!   - Emit one `ArtworkUpdated` per asset saved, and `Toast{Warning}` once if everything failed.
//!   - Rate-limit SteamGridDB (max ~4 requests/sec) - a simple sleep between calls is fine in V1.

pub mod cache;
pub mod steam_cdn;
pub mod steamgriddb;

use std::sync::Arc;

use crate::error::Result;
use crate::model::*;
use crate::Core;

/// Background fetch for one entry (spawns a thread).
pub fn start_fetch(core: Arc<Core>, entry_id: String, force: bool) {
    let _ = (core, entry_id, force);
    todo!("artwork::start_fetch")
}

/// Blocking fetch. Returns the resulting artwork row (possibly unchanged).
pub fn fetch_for_entry(core: &Core, entry: &Entry, force: bool) -> Result<Artwork> {
    let _ = (core, entry, force);
    todo!("artwork::fetch_for_entry")
}

/// User replaces one asset. Copies the file into the cache dir and marks `user_override`.
pub fn set_override(core: &Core, entry_id: &str, kind: ArtworkKind, path: &str) -> Result<Artwork> {
    let _ = (core, entry_id, kind, path);
    todo!("artwork::set_override")
}
