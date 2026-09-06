//! `entries` repository.

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Row};

use super::Db;
use crate::error::Result;
use crate::model::{Entry, EntryFilter, EntryType, SortKey, Source, UpdateEntryPatch};

const COLUMNS: &str = "e.id, e.name, e.type, e.source, e.source_id, e.launch, \
                       e.install_path, e.install_size, e.created_at, e.updated_at";

fn conv(idx: usize, e: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e))
}

fn row_to_entry(row: &Row<'_>) -> rusqlite::Result<Entry> {
    let type_str: String = row.get(2)?;
    let source_str: String = row.get(3)?;
    let launch_str: String = row.get(5)?;
    Ok(Entry {
        id: row.get(0)?,
        name: row.get(1)?,
        entry_type: EntryType::parse(&type_str).unwrap_or(EntryType::App),
        source: Source::parse(&source_str).unwrap_or(Source::Manual),
        source_id: row.get(4)?,
        launch: serde_json::from_str(&launch_str).map_err(|e| conv(5, e))?,
        install_path: row.get(6)?,
        install_size: row.get::<_, Option<i64>>(7)?.map(|v| v.max(0) as u64),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

/// Insert or update by primary key. Also ensures matching `artwork` and `stats` rows exist.
pub fn upsert(db: &Db, entry: &Entry) -> Result<()> {
    let launch = serde_json::to_string(&entry.launch)?;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO entries
           (id, name, type, source, source_id, launch, install_path, install_size, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           name         = excluded.name,
           type         = excluded.type,
           source       = excluded.source,
           source_id    = excluded.source_id,
           launch       = excluded.launch,
           install_path = excluded.install_path,
           install_size = excluded.install_size,
           updated_at   = excluded.updated_at",
        params![
            entry.id,
            entry.name,
            entry.entry_type.as_str(),
            entry.source.as_str(),
            entry.source_id,
            launch,
            entry.install_path,
            entry.install_size.map(|v| v as i64),
            entry.created_at,
            entry.updated_at,
        ],
    )?;
    conn.execute("INSERT OR IGNORE INTO artwork (entry_id) VALUES (?1)", params![entry.id])?;
    conn.execute("INSERT OR IGNORE INTO stats (entry_id) VALUES (?1)", params![entry.id])?;
    Ok(())
}

pub fn get(db: &Db, id: &str) -> Result<Option<Entry>> {
    let conn = db.conn();
    let sql = format!("SELECT {COLUMNS} FROM entries e WHERE e.id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_entry).optional()?)
}

/// Look up a store entry by `(source, source_id)` so scanners can update instead of duplicate.
pub fn find_by_source(db: &Db, source: Source, source_id: &str) -> Result<Option<Entry>> {
    let conn = db.conn();
    let sql = format!("SELECT {COLUMNS} FROM entries e WHERE e.source = ?1 AND e.source_id = ?2");
    Ok(conn.query_row(&sql, params![source.as_str(), source_id], row_to_entry).optional()?)
}

/// Filtered, sorted listing. Hidden entries are excluded unless `filter.include_hidden`.
/// Sorting by `LastPlayed` / `Playtime` joins `stats`.
pub fn list(db: &Db, filter: &EntryFilter) -> Result<Vec<Entry>> {
    let mut sql = format!(
        "SELECT {COLUMNS} FROM entries e LEFT JOIN stats s ON s.entry_id = e.id WHERE 1 = 1"
    );
    let mut args: Vec<Value> = Vec::new();

    if let Some(t) = filter.entry_type {
        args.push(Value::Text(t.as_str().to_string()));
        sql.push_str(&format!(" AND e.type = ?{}", args.len()));
    }
    if let Some(src) = filter.source {
        args.push(Value::Text(src.as_str().to_string()));
        sql.push_str(&format!(" AND e.source = ?{}", args.len()));
    }
    if !filter.include_hidden {
        sql.push_str(" AND COALESCE(s.hidden, 0) = 0");
    }
    if filter.favourites_only {
        sql.push_str(" AND COALESCE(s.favourite, 0) = 1");
    }
    if let Some(term) = filter.search.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        // Escape LIKE wildcards so a user typing % or _ searches for them literally.
        let escaped = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        args.push(Value::Text(format!("%{escaped}%")));
        sql.push_str(&format!(" AND e.name LIKE ?{} ESCAPE '\\'", args.len()));
    }

    sql.push_str(match filter.sort {
        SortKey::Name => " ORDER BY e.name COLLATE NOCASE ASC",
        SortKey::LastPlayed => {
            " ORDER BY COALESCE(s.last_played, 0) DESC, e.name COLLATE NOCASE ASC"
        }
        SortKey::Playtime => {
            " ORDER BY COALESCE(s.playtime_secs, 0) DESC, e.name COLLATE NOCASE ASC"
        }
        SortKey::RecentlyAdded => " ORDER BY e.created_at DESC, e.name COLLATE NOCASE ASC",
    });

    if let Some(limit) = filter.limit {
        args.push(Value::Integer(limit as i64));
        sql.push_str(&format!(" LIMIT ?{}", args.len()));
    }

    let conn = db.conn();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), row_to_entry)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Apply `name` / `launch` from the patch (flags live in `stats`). Returns the updated entry.
pub fn update_patch(db: &Db, id: &str, patch: &UpdateEntryPatch, now: i64) -> Result<Option<Entry>> {
    if get(db, id)?.is_none() {
        return Ok(None);
    }
    if patch.name.is_some() || patch.launch.is_some() {
        let launch = match &patch.launch {
            Some(spec) => Some(serde_json::to_string(spec)?),
            None => None,
        };
        let conn = db.conn();
        conn.execute(
            "UPDATE entries SET
               name       = COALESCE(?2, name),
               launch     = COALESCE(?3, launch),
               updated_at = ?4
             WHERE id = ?1",
            params![id, patch.name, launch, now],
        )?;
    }
    get(db, id)
}

pub fn delete(db: &Db, id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute("DELETE FROM entries WHERE id = ?1", params![id])? > 0)
}

/// Ids of all entries from a source - used by scanners to detect uninstalled games.
pub fn ids_for_source(db: &Db, source: Source) -> Result<Vec<(String, Option<String>)>> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT id, source_id FROM entries WHERE source = ?1")?;
    let rows = stmt.query_map(params![source.as_str()], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LaunchSpec;

    fn db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    fn entry(id: &str, name: &str, source: Source, source_id: Option<&str>) -> Entry {
        Entry {
            id: id.into(),
            name: name.into(),
            entry_type: EntryType::Game,
            source,
            source_id: source_id.map(String::from),
            launch: LaunchSpec::Uri { uri: format!("steam://rungameid/{id}") },
            install_path: None,
            install_size: Some(1024),
            created_at: 10,
            updated_at: 10,
        }
    }

    #[test]
    fn upsert_get_and_child_rows() {
        let db = db();
        let e = entry("a", "Portal 2", Source::Steam, Some("620"));
        upsert(&db, &e).unwrap();
        assert_eq!(get(&db, "a").unwrap().unwrap(), e);
        let n: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM artwork WHERE entry_id='a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "upsert must create the artwork row");

        let mut e2 = e.clone();
        e2.name = "Portal II".into();
        e2.updated_at = 20;
        upsert(&db, &e2).unwrap();
        assert_eq!(get(&db, "a").unwrap().unwrap().name, "Portal II");
        assert_eq!(find_by_source(&db, Source::Steam, "620").unwrap().unwrap().id, "a");
    }

    #[test]
    fn list_filters_sorts_and_hides() {
        let db = db();
        upsert(&db, &entry("a", "Zebra", Source::Steam, Some("1"))).unwrap();
        upsert(&db, &entry("b", "apple", Source::Steam, Some("2"))).unwrap();
        upsert(&db, &entry("c", "Hidden", Source::Manual, None)).unwrap();
        super::super::stats::set_flags(&db, "c", None, Some(true)).unwrap();

        let all = list(&db, &EntryFilter::default()).unwrap();
        assert_eq!(all.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["apple", "Zebra"]);

        let with_hidden =
            list(&db, &EntryFilter { include_hidden: true, ..Default::default() }).unwrap();
        assert_eq!(with_hidden.len(), 3);

        let steam =
            list(&db, &EntryFilter { source: Some(Source::Steam), ..Default::default() }).unwrap();
        assert_eq!(steam.len(), 2);

        let search =
            list(&db, &EntryFilter { search: Some("ppl".into()), ..Default::default() }).unwrap();
        assert_eq!(search.len(), 1);

        let limited = list(&db, &EntryFilter { limit: Some(1), ..Default::default() }).unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn search_treats_wildcards_literally() {
        let db = db();
        upsert(&db, &entry("a", "100% Orange Juice", Source::Manual, None)).unwrap();
        upsert(&db, &entry("b", "Other", Source::Manual, None)).unwrap();
        let hits =
            list(&db, &EntryFilter { search: Some("100%".into()), ..Default::default() }).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn patch_updates_and_delete_cascades() {
        let db = db();
        upsert(&db, &entry("a", "Old", Source::Manual, None)).unwrap();
        let patch = UpdateEntryPatch { name: Some("New".into()), ..Default::default() };
        let updated = update_patch(&db, "a", &patch, 99).unwrap().unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.updated_at, 99);
        assert!(update_patch(&db, "missing", &patch, 99).unwrap().is_none());

        assert!(delete(&db, "a").unwrap());
        assert!(!delete(&db, "a").unwrap());
        let n: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM stats WHERE entry_id='a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "stats must cascade");
    }

    #[test]
    fn ids_for_source_lists_pairs() {
        let db = db();
        upsert(&db, &entry("a", "A", Source::Steam, Some("620"))).unwrap();
        upsert(&db, &entry("b", "B", Source::Manual, None)).unwrap();
        let ids = ids_for_source(&db, Source::Steam).unwrap();
        assert_eq!(ids, vec![("a".to_string(), Some("620".to_string()))]);
    }
}
