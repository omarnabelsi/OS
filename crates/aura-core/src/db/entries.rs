//! `entries` repository.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-db agent).

use super::Db;
use crate::error::Result;
use crate::model::{Entry, EntryFilter, Source, UpdateEntryPatch};

/// Insert or update by primary key. Also ensures matching `artwork` and `stats` rows exist.
pub fn upsert(db: &Db, entry: &Entry) -> Result<()> {
    let _ = (db, entry);
    todo!("db::entries::upsert")
}

pub fn get(db: &Db, id: &str) -> Result<Option<Entry>> {
    let _ = (db, id);
    todo!("db::entries::get")
}

/// Look up a store entry by `(source, source_id)` so scanners can update instead of duplicate.
pub fn find_by_source(db: &Db, source: Source, source_id: &str) -> Result<Option<Entry>> {
    let _ = (db, source, source_id);
    todo!("db::entries::find_by_source")
}

/// Filtered, sorted listing. Hidden entries are excluded unless `filter.include_hidden`.
/// Sorting by `LastPlayed` / `Playtime` joins `stats`.
pub fn list(db: &Db, filter: &EntryFilter) -> Result<Vec<Entry>> {
    let _ = (db, filter);
    todo!("db::entries::list")
}

/// Apply `name` / `launch` from the patch (flags live in `stats`). Returns the updated entry.
pub fn update_patch(db: &Db, id: &str, patch: &UpdateEntryPatch, now: i64) -> Result<Option<Entry>> {
    let _ = (db, id, patch, now);
    todo!("db::entries::update_patch")
}

pub fn delete(db: &Db, id: &str) -> Result<bool> {
    let _ = (db, id);
    todo!("db::entries::delete")
}

/// Ids of all entries from a source - used by scanners to detect uninstalled games.
pub fn ids_for_source(db: &Db, source: Source) -> Result<Vec<(String, Option<String>)>> {
    let _ = (db, source);
    todo!("db::entries::ids_for_source")
}
