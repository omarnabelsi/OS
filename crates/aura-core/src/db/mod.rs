//! SQLite persistence. One connection behind a mutex is plenty for a single-user desktop app;
//! scanners batch their writes inside a transaction.
//!
//! Tables (see `schema.sql`): entries, artwork, stats, collections, collection_items, folders,
//! themes, settings. Repositories live one per file.

pub mod artwork;
pub mod entries;
pub mod settings;
pub mod stats;
pub mod themes;

use std::path::Path;

use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;

use crate::error::Result;

pub const SCHEMA_SQL: &str = include_str!("schema.sql");
/// Bump when `schema.sql` changes and add a step to [`Db::migrate`].
pub const SCHEMA_VERSION: i64 = 1;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn open_in_memory() -> Result<Db> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        Ok(Db { conn: Mutex::new(conn) })
    }

    fn configure(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(())
    }

    /// Lock the connection. Keep the guard short-lived.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock()
    }

    /// Create or upgrade the schema. Uses `PRAGMA user_version` as the migration marker.
    pub fn migrate(&self) -> Result<()> {
        let conn = self.conn();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_SQL)?;
        }
        // Future migrations: `if version < 2 { ... }`
        if version < SCHEMA_VERSION {
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self.conn().query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_schema() {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        let n: i64 = db
            .conn()
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('entries','artwork','stats','collections','folders','themes','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 7);
        // idempotent
        db.migrate().unwrap();
    }
}
