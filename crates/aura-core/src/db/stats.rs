//! `stats` repository.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-db agent).

use super::Db;
use crate::error::Result;
use crate::model::Stats;

/// Returns `Stats::default()` when no row exists.
pub fn get(db: &Db, entry_id: &str) -> Result<Stats> {
    let _ = (db, entry_id);
    todo!("db::stats::get")
}

/// launch_count += 1, last_played = now.
pub fn record_launch(db: &Db, entry_id: &str, now: i64) -> Result<Stats> {
    let _ = (db, entry_id, now);
    todo!("db::stats::record_launch")
}

pub fn add_playtime(db: &Db, entry_id: &str, secs: u64) -> Result<Stats> {
    let _ = (db, entry_id, secs);
    todo!("db::stats::add_playtime")
}

pub fn set_flags(db: &Db, entry_id: &str, favourite: Option<bool>, hidden: Option<bool>) -> Result<Stats> {
    let _ = (db, entry_id, favourite, hidden);
    todo!("db::stats::set_flags")
}
