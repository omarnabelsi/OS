//! `artwork` repository.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-db agent).

use super::Db;
use crate::error::Result;
use crate::model::{Artwork, ArtworkKind};

/// Returns `Artwork::default()` when no row exists.
pub fn get(db: &Db, entry_id: &str) -> Result<Artwork> {
    let _ = (db, entry_id);
    todo!("db::artwork::get")
}

pub fn set(db: &Db, entry_id: &str, artwork: &Artwork, fetched_at: Option<i64>) -> Result<()> {
    let _ = (db, entry_id, artwork, fetched_at);
    todo!("db::artwork::set")
}

/// Update a single asset path. When `user_override` is true the row is marked as user-edited.
pub fn set_kind(db: &Db, entry_id: &str, kind: ArtworkKind, path: Option<&str>, source: &str, user_override: bool) -> Result<Artwork> {
    let _ = (db, entry_id, kind, path, source, user_override);
    todo!("db::artwork::set_kind")
}

/// Entries whose artwork is missing `grid` or `hero` and are not user-overridden.
pub fn incomplete_entry_ids(db: &Db) -> Result<Vec<String>> {
    let _ = db;
    todo!("db::artwork::incomplete_entry_ids")
}
