//! `stats` repository.

use rusqlite::{params, OptionalExtension, Row};

use super::Db;
use crate::error::Result;
use crate::model::Stats;

fn row_to_stats(row: &Row<'_>) -> rusqlite::Result<Stats> {
    Ok(Stats {
        playtime_secs: row.get::<_, i64>(0)?.max(0) as u64,
        launch_count: row.get::<_, i64>(1)?.max(0) as u32,
        last_played: row.get(2)?,
        favourite: row.get::<_, i64>(3)? != 0,
        hidden: row.get::<_, i64>(4)? != 0,
    })
}

/// Returns `Stats::default()` when no row exists.
pub fn get(db: &Db, entry_id: &str) -> Result<Stats> {
    let conn = db.conn();
    let found = conn
        .query_row(
            "SELECT playtime_secs, launch_count, last_played, favourite, hidden
             FROM stats WHERE entry_id = ?1",
            params![entry_id],
            row_to_stats,
        )
        .optional()?;
    Ok(found.unwrap_or_default())
}

/// launch_count += 1, last_played = now.
pub fn record_launch(db: &Db, entry_id: &str, now: i64) -> Result<Stats> {
    {
        let conn = db.conn();
        conn.execute(
            "INSERT OR IGNORE INTO stats (entry_id) VALUES (?1)",
            params![entry_id],
        )?;
        conn.execute(
            "UPDATE stats SET launch_count = launch_count + 1, last_played = ?2 WHERE entry_id = ?1",
            params![entry_id, now],
        )?;
    }
    get(db, entry_id)
}

pub fn add_playtime(db: &Db, entry_id: &str, secs: u64) -> Result<Stats> {
    {
        let conn = db.conn();
        conn.execute(
            "INSERT OR IGNORE INTO stats (entry_id) VALUES (?1)",
            params![entry_id],
        )?;
        conn.execute(
            "UPDATE stats SET playtime_secs = playtime_secs + ?2 WHERE entry_id = ?1",
            params![entry_id, secs as i64],
        )?;
    }
    get(db, entry_id)
}

/// `None` leaves a flag untouched.
pub fn set_flags(
    db: &Db,
    entry_id: &str,
    favourite: Option<bool>,
    hidden: Option<bool>,
) -> Result<Stats> {
    {
        let conn = db.conn();
        conn.execute(
            "INSERT OR IGNORE INTO stats (entry_id) VALUES (?1)",
            params![entry_id],
        )?;
        conn.execute(
            "UPDATE stats SET
               favourite = COALESCE(?2, favourite),
               hidden    = COALESCE(?3, hidden)
             WHERE entry_id = ?1",
            params![entry_id, favourite, hidden],
        )?;
    }
    get(db, entry_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Entry, EntryType, LaunchSpec, Source};

    fn db_with_entry(id: &str) -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        let e = Entry {
            id: id.into(),
            name: id.into(),
            entry_type: EntryType::Game,
            source: Source::Manual,
            source_id: None,
            launch: LaunchSpec::Exe {
                path: "a.exe".into(),
                args: vec![],
                cwd: None,
            },
            install_path: None,
            install_size: None,
            created_at: 1,
            updated_at: 1,
        };
        super::super::entries::upsert(&db, &e).unwrap();
        db
    }

    #[test]
    fn missing_row_is_default() {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        assert_eq!(get(&db, "nope").unwrap(), Stats::default());
    }

    #[test]
    fn launch_and_playtime_accumulate() {
        let db = db_with_entry("a");
        let s = record_launch(&db, "a", 1000).unwrap();
        assert_eq!(s.launch_count, 1);
        assert_eq!(s.last_played, Some(1000));

        let s = record_launch(&db, "a", 2000).unwrap();
        assert_eq!(s.launch_count, 2);
        assert_eq!(s.last_played, Some(2000));

        add_playtime(&db, "a", 60).unwrap();
        let s = add_playtime(&db, "a", 30).unwrap();
        assert_eq!(s.playtime_secs, 90);
    }

    #[test]
    fn flags_update_independently() {
        let db = db_with_entry("a");
        let s = set_flags(&db, "a", Some(true), None).unwrap();
        assert!(s.favourite && !s.hidden);

        let s = set_flags(&db, "a", None, Some(true)).unwrap();
        assert!(s.favourite, "favourite must survive a hidden-only patch");
        assert!(s.hidden);

        let s = set_flags(&db, "a", Some(false), None).unwrap();
        assert!(!s.favourite && s.hidden);
    }
}
