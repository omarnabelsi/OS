//! `themes` repository: which theme packages are installed/enabled and the user's token
//! overrides. In V1 discovery is filesystem-driven; this table only stores state.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-db agent).

use serde::{Deserialize, Serialize};

use super::Db;
use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeRow {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub token_overrides: Option<serde_json::Value>,
    pub installed_at: i64,
}

pub fn list(db: &Db) -> Result<Vec<ThemeRow>> {
    let _ = db;
    todo!("db::themes::list")
}

pub fn upsert(db: &Db, row: &ThemeRow) -> Result<()> {
    let _ = (db, row);
    todo!("db::themes::upsert")
}

pub fn set_enabled(db: &Db, id: &str, enabled: bool) -> Result<()> {
    let _ = (db, id, enabled);
    todo!("db::themes::set_enabled")
}

pub fn set_token_overrides(db: &Db, id: &str, overrides: Option<&serde_json::Value>) -> Result<()> {
    let _ = (db, id, overrides);
    todo!("db::themes::set_token_overrides")
}
