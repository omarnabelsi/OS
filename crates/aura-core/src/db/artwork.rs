//! `artwork` repository.

use rusqlite::{params, OptionalExtension, Row};

use super::Db;
use crate::error::Result;
use crate::model::{Artwork, ArtworkKind};

fn row_to_artwork(row: &Row<'_>) -> rusqlite::Result<Artwork> {
    Ok(Artwork {
        grid: row.get(0)?,
        hero: row.get(1)?,
        logo: row.get(2)?,
        icon: row.get(3)?,
        source: row.get(4)?,
        user_override: row.get::<_, i64>(5)? != 0,
    })
}

/// Returns `Artwork::default()` when no row exists.
pub fn get(db: &Db, entry_id: &str) -> Result<Artwork> {
    let conn = db.conn();
    let found = conn
        .query_row(
            "SELECT grid, hero, logo, icon, source, user_override FROM artwork WHERE entry_id = ?1",
            params![entry_id],
            row_to_artwork,
        )
        .optional()?;
    Ok(found.unwrap_or_default())
}

pub fn set(db: &Db, entry_id: &str, artwork: &Artwork, fetched_at: Option<i64>) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO artwork (entry_id, grid, hero, logo, icon, source, user_override, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(entry_id) DO UPDATE SET
           grid          = excluded.grid,
           hero          = excluded.hero,
           logo          = excluded.logo,
           icon          = excluded.icon,
           source        = excluded.source,
           user_override = excluded.user_override,
           fetched_at    = excluded.fetched_at",
        params![
            entry_id,
            artwork.grid,
            artwork.hero,
            artwork.logo,
            artwork.icon,
            artwork.source,
            artwork.user_override as i64,
            fetched_at,
        ],
    )?;
    Ok(())
}

/// Update a single asset path. When `user_override` is true the row is marked as user-edited.
/// A row that is already user-edited keeps that flag even when a scanner writes to it.
pub fn set_kind(
    db: &Db,
    entry_id: &str,
    kind: ArtworkKind,
    path: Option<&str>,
    source: &str,
    user_override: bool,
) -> Result<Artwork> {
    let column = kind.as_str();
    {
        let conn = db.conn();
        conn.execute("INSERT OR IGNORE INTO artwork (entry_id) VALUES (?1)", params![entry_id])?;
        // `column` is one of four hard-coded identifiers, never user input.
        let sql = format!(
            "UPDATE artwork SET
               {column}       = ?2,
               source        = ?3,
               user_override = CASE WHEN ?4 = 1 THEN 1 ELSE user_override END,
               fetched_at    = ?5
             WHERE entry_id = ?1"
        );
        conn.execute(
            &sql,
            params![entry_id, path, source, user_override as i64, crate::now_secs()],
        )?;
    }
    get(db, entry_id)
}

/// Entries whose artwork is missing `grid` or `hero` and are not user-overridden.
pub fn incomplete_entry_ids(db: &Db) -> Result<Vec<String>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT e.id FROM entries e
         LEFT JOIN artwork a ON a.entry_id = e.id
         WHERE COALESCE(a.user_override, 0) = 0
           AND (a.grid IS NULL OR a.hero IS NULL)
         ORDER BY e.created_at ASC",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
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
            source: Source::Steam,
            source_id: Some(id.into()),
            launch: LaunchSpec::Uri { uri: "steam://rungameid/1".into() },
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
        assert_eq!(get(&db, "nope").unwrap(), Artwork::default());
    }

    #[test]
    fn set_kind_updates_one_asset() {
        let db = db_with_entry("a");
        let art = set_kind(&db, "a", ArtworkKind::Grid, Some("C:/g.jpg"), "steam_cdn", false).unwrap();
        assert_eq!(art.grid.as_deref(), Some("C:/g.jpg"));
        assert_eq!(art.source.as_deref(), Some("steam_cdn"));
        assert!(!art.user_override);
        assert!(art.hero.is_none());

        let art = set_kind(&db, "a", ArtworkKind::Hero, Some("C:/h.jpg"), "user", true).unwrap();
        assert!(art.user_override);
        assert!(art.is_complete());

        // A later scanner write must not clear the user_override flag.
        let art = set_kind(&db, "a", ArtworkKind::Logo, Some("C:/l.png"), "steam_cdn", false).unwrap();
        assert!(art.user_override, "user_override must be sticky");
    }

    #[test]
    fn round_trips_whole_row() {
        let db = db_with_entry("a");
        let art = Artwork {
            grid: Some("g".into()),
            hero: Some("h".into()),
            logo: None,
            icon: Some("i".into()),
            source: Some("steamgriddb".into()),
            user_override: true,
        };
        set(&db, "a", &art, Some(500)).unwrap();
        assert_eq!(get(&db, "a").unwrap(), art);
    }

    #[test]
    fn incomplete_lists_missing_and_skips_overrides() {
        let db = db_with_entry("a");
        assert_eq!(incomplete_entry_ids(&db).unwrap(), vec!["a".to_string()]);

        set_kind(&db, "a", ArtworkKind::Grid, Some("g"), "steam_cdn", false).unwrap();
        assert_eq!(incomplete_entry_ids(&db).unwrap(), vec!["a".to_string()], "hero still missing");

        set_kind(&db, "a", ArtworkKind::Hero, Some("h"), "steam_cdn", false).unwrap();
        assert!(incomplete_entry_ids(&db).unwrap().is_empty());

        // user_override rows are never re-fetched, even when incomplete
        set(&db, "a", &Artwork { user_override: true, ..Default::default() }, None).unwrap();
        assert!(incomplete_entry_ids(&db).unwrap().is_empty());
    }
}
