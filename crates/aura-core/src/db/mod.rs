//! SQLite persistence. One connection behind a mutex is plenty for a single-user desktop app;
//! scanners batch their writes inside a transaction.
//!
//! Tables (see `schema.sql`): entries, artwork, stats, collections, collection_items, folders,
//! themes, settings. Repositories live one per file.

pub mod artwork;
pub mod desktops;
pub mod entries;
pub mod folders;
pub mod settings;
pub mod stats;
pub mod taskbar;
pub mod themes;

use std::path::{Path, PathBuf};

use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;

use crate::error::Result;

pub const SCHEMA_SQL: &str = include_str!("schema.sql");
/// v2 adds the desktop surface: desktops, desktop_items, taskbar_items and the folder columns.
pub const SCHEMA_V2_SQL: &str = include_str!("schema_v2.sql");
/// Bump when the schema changes and add a step to [`Db::migrate`].
pub const SCHEMA_VERSION: i64 = 2;

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
    ///
    /// Call [`Db::backup_before_migration`] first when the database is a real file: by v2 there
    /// is playtime, favourites and artwork in here that no scan can reconstruct.
    pub fn migrate(&self) -> Result<()> {
        let conn = self.conn();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_SQL)?;
        }
        if version < 2 {
            conn.execute_batch(SCHEMA_V2_SQL)?;
            Self::add_missing_columns(
                &conn,
                "folders",
                &[
                    ("shape", "TEXT"),
                    ("kind", "TEXT NOT NULL DEFAULT 'filesystem'"),
                    ("collection_id", "TEXT"),
                    ("filter", "TEXT"),
                    ("window_state", "TEXT"),
                ],
            )?;
        }
        if version < SCHEMA_VERSION {
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(())
    }

    /// Copy the database aside before an upgrade rewrites it. Returns the backup path, or None
    /// when nothing needed backing up (a brand-new database, or one already current).
    ///
    /// docs/RISKS.md R8 flagged the absence of this; the desktop migration is the largest the
    /// project has had, so it lands with the migration rather than after it.
    pub fn backup_before_migration(&self, db_path: &Path) -> Result<Option<PathBuf>> {
        let version = self.schema_version()?;
        // 0 = the file was just created; there is nothing in it worth keeping.
        if version == 0 || version >= SCHEMA_VERSION || !db_path.is_file() {
            return Ok(None);
        }
        // Fold the write-ahead log into the main file first, or the copy misses recent writes.
        self.conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

        let mut name = db_path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".bak-v{version}"));
        let dest = db_path.with_file_name(name);
        std::fs::copy(db_path, &dest)?;
        tracing::info!("backed up schema v{version} database to {}", dest.display());
        Ok(Some(dest))
    }

    /// Add each column only if the table does not already have it.
    ///
    /// `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS`. Replaying it raises "duplicate
    /// column name", so a migration interrupted after the ALTERs but before the `user_version`
    /// bump would fail on every start from then on - an unrecoverable install from one badly
    /// timed crash. Checking first makes the step replayable.
    ///
    /// `table` and the declarations are compile-time literals from `migrate`, never user input,
    /// which is why they can be formatted into the statement.
    fn add_missing_columns(
        conn: &Connection,
        table: &str,
        columns: &[(&str, &str)],
    ) -> Result<()> {
        let existing: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (name, decl) in columns {
            if !existing.contains(*name) {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {decl};"))?;
            }
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
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('entries','artwork','stats','collections','folders','themes','settings','desktops','desktop_items','taskbar_items')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 10);
        // idempotent
        db.migrate().unwrap();
    }

    /// The upgrade path that matters: a v1 database with real rows in it must reach v2 with
    /// every row intact and the new columns available.
    #[test]
    fn v1_data_survives_the_v2_upgrade() {
        let db = Db::open_in_memory().unwrap();
        {
            let conn = db.conn();
            conn.execute_batch(SCHEMA_SQL).unwrap();
            conn.pragma_update(None, "user_version", 1i64).unwrap();
            conn.execute(
                "INSERT INTO entries (id, name, type, source, source_id, launch, created_at, updated_at)
                 VALUES ('e1', 'Portal 2', 'game', 'steam', '620', '{}', 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO stats (entry_id, playtime_secs, favourite) VALUES ('e1', 9999, 1)",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO folders (id, path) VALUES ('f1', 'C:/games')", []).unwrap();
        }

        db.migrate().unwrap();
        assert_eq!(db.schema_version().unwrap(), 2);

        let conn = db.conn();
        let (playtime, fav): (i64, i64) = conn
            .query_row("SELECT playtime_secs, favourite FROM stats WHERE entry_id='e1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((playtime, fav), (9999, 1), "playtime and favourites must survive");

        // The pre-existing folder gains the new columns with sane defaults.
        let kind: String =
            conn.query_row("SELECT kind FROM folders WHERE id='f1'", [], |r| r.get(0)).unwrap();
        assert_eq!(kind, "filesystem");
        let shape: Option<String> =
            conn.query_row("SELECT shape FROM folders WHERE id='f1'", [], |r| r.get(0)).unwrap();
        assert_eq!(shape, None);
    }

    #[test]
    fn a_fresh_database_is_not_backed_up_but_an_upgrade_is() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("aura.db");

        // Brand new: nothing to lose, so no backup file is left lying around.
        {
            let db = Db::open(&path).unwrap();
            assert_eq!(db.backup_before_migration(&path).unwrap(), None);
            db.migrate().unwrap();
        }

        // Pretend it is a v1 database again and upgrade it.
        {
            let db = Db::open(&path).unwrap();
            db.conn().pragma_update(None, "user_version", 1i64).unwrap();
            let backup = db.backup_before_migration(&path).unwrap().expect("v1 must be backed up");
            assert!(backup.is_file());
            assert_eq!(backup.file_name().unwrap(), "aura.db.bak-v1");
            db.migrate().unwrap();
            // Already current: a second attempt does not pile up copies.
            assert_eq!(db.backup_before_migration(&path).unwrap(), None);
        }
    }

    /// A crash between the column additions and the `user_version` bump must not brick the
    /// install: the next start replays the step and succeeds.
    #[test]
    fn an_interrupted_migration_can_be_replayed() {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();

        // Exactly the half-finished state: v2 columns present, version still says v1.
        db.conn().pragma_update(None, "user_version", 1i64).unwrap();

        db.migrate().expect("replaying the v2 step must not fail on duplicate columns");
        assert_eq!(db.schema_version().unwrap(), 2);
    }
}
