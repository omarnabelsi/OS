//! `folders` repository.
//!
//! The table shipped in schema v1 marked "V2 - pinned locations for the file browser"; v2 added
//! the columns the desktop needs (`shape`, `kind`, `collection_id`, `filter`, `window_state`)
//! rather than starting a parallel table.
//!
//! `path` stays the unique locator. Virtual folders have no filesystem path, so they use a
//! scheme prefix instead: `smart:all-games`, `collection:<uuid>`.

use rusqlite::{params, OptionalExtension, Row};

use super::Db;
use crate::error::{CoreError, Result};
use crate::model::{EntryFilter, Folder, FolderKind, FolderLayout, FolderPatch, NewFolder};

const COLS: &str = "id, path, label, color, icon, cover, layout, shape, kind, collection_id, \
                    filter, window_state, sort_order";

fn parse_layout(s: Option<String>) -> FolderLayout {
    match s.as_deref() {
        Some("list") => FolderLayout::List,
        Some("covers") => FolderLayout::Covers,
        _ => FolderLayout::Grid,
    }
}

fn layout_str(l: FolderLayout) -> &'static str {
    match l {
        FolderLayout::Grid => "grid",
        FolderLayout::List => "list",
        FolderLayout::Covers => "covers",
    }
}

fn row_to_folder(row: &Row<'_>) -> rusqlite::Result<Folder> {
    let layout: Option<String> = row.get(6)?;
    let kind: Option<String> = row.get(8)?;
    let filter: Option<String> = row.get(10)?;
    let window_state: Option<String> = row.get(11)?;
    Ok(Folder {
        id: row.get(0)?,
        path: row.get(1)?,
        label: row.get(2)?,
        color: row.get(3)?,
        icon: row.get(4)?,
        cover: row.get(5)?,
        layout: parse_layout(layout),
        shape: row.get(7)?,
        kind: kind
            .as_deref()
            .and_then(FolderKind::parse)
            .unwrap_or_default(),
        collection_id: row.get(9)?,
        // Unreadable JSON degrades to "no filter" rather than refusing to list the folder.
        filter: filter.and_then(|f| serde_json::from_str(&f).ok()),
        window_state: window_state.and_then(|w| serde_json::from_str(&w).ok()),
        sort_order: row.get(12)?,
    })
}

pub fn list(db: &Db) -> Result<Vec<Folder>> {
    let conn = db.conn();
    let sql = format!("SELECT {COLS} FROM folders ORDER BY sort_order ASC, label ASC, path ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_folder)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get(db: &Db, id: &str) -> Result<Option<Folder>> {
    let conn = db.conn();
    let sql = format!("SELECT {COLS} FROM folders WHERE id = ?1");
    Ok(conn
        .query_row(&sql, params![id], row_to_folder)
        .optional()?)
}

pub fn find_by_path(db: &Db, path: &str) -> Result<Option<Folder>> {
    let conn = db.conn();
    let sql = format!("SELECT {COLS} FROM folders WHERE path = ?1");
    Ok(conn
        .query_row(&sql, params![path], row_to_folder)
        .optional()?)
}

/// The locator a folder of this kind should occupy, given what the caller supplied.
fn locator(input: &NewFolder, id: &str) -> Result<String> {
    let kind = input.kind.unwrap_or_default();
    match kind {
        FolderKind::Filesystem => input
            .path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(String::from)
            .ok_or_else(|| CoreError::Invalid("a filesystem folder needs a path".into())),
        FolderKind::Collection => {
            let collection = input.collection_id.as_deref().unwrap_or(id);
            Ok(format!("collection:{collection}"))
        }
        // Smart folders are keyed by their label when they have one, so the seeded set gets
        // readable locators ("smart:all-games") instead of uuids.
        FolderKind::Smart => {
            let slug = input
                .label
                .as_deref()
                .map(slugify)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| id.to_string());
            Ok(format!("smart:{slug}"))
        }
    }
}

/// "All games" -> "all-games". Lowercase, non-alphanumerics collapsed to single dashes.
pub fn slugify(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut pending_dash = false;
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.extend(ch.to_lowercase());
        } else {
            pending_dash = true;
        }
    }
    out
}

pub fn create(db: &Db, input: &NewFolder) -> Result<Folder> {
    let id = uuid::Uuid::new_v4().to_string();
    let folder = Folder {
        path: locator(input, &id)?,
        id,
        label: input.label.clone(),
        color: input.color.clone(),
        icon: input.icon.clone(),
        cover: input.cover.clone(),
        layout: input.layout.unwrap_or_default(),
        shape: input.shape.clone(),
        kind: input.kind.unwrap_or_default(),
        collection_id: input.collection_id.clone(),
        filter: input.filter.clone(),
        window_state: None,
        sort_order: 0,
    };
    put(db, &folder)?;
    Ok(folder)
}

pub fn put(db: &Db, folder: &Folder) -> Result<()> {
    let filter = match &folder.filter {
        Some(f) => Some(serde_json::to_string(f)?),
        None => None,
    };
    let window_state = match &folder.window_state {
        Some(w) => Some(serde_json::to_string(w)?),
        None => None,
    };
    let conn = db.conn();
    conn.execute(
        "INSERT INTO folders
           (id, path, label, color, icon, cover, layout, shape, kind, collection_id, filter,
            window_state, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
           path          = excluded.path,
           label         = excluded.label,
           color         = excluded.color,
           icon          = excluded.icon,
           cover         = excluded.cover,
           layout        = excluded.layout,
           shape         = excluded.shape,
           kind          = excluded.kind,
           collection_id = excluded.collection_id,
           filter        = excluded.filter,
           window_state  = excluded.window_state,
           sort_order    = excluded.sort_order",
        params![
            folder.id,
            folder.path,
            folder.label,
            folder.color,
            folder.icon,
            folder.cover,
            layout_str(folder.layout),
            folder.shape,
            folder.kind.as_str(),
            folder.collection_id,
            filter,
            window_state,
            folder.sort_order,
        ],
    )?;
    Ok(())
}

/// Apply the folder editor's patch. An absent field is left alone; an explicit `null` clears it.
pub fn patch(db: &Db, id: &str, patch: &FolderPatch) -> Result<Folder> {
    let mut folder = get(db, id)?.ok_or_else(|| CoreError::NotFound(format!("folder `{id}`")))?;

    // Outer `None` = absent, leave it; `Some(None)` = null, clear it; `Some(Some(v))` = set it.
    if let Some(label) = &patch.label {
        folder.label = label.clone();
    }
    if let Some(color) = &patch.color {
        folder.color = color.clone();
    }
    if let Some(icon) = &patch.icon {
        folder.icon = icon.clone();
    }
    if let Some(cover) = &patch.cover {
        folder.cover = cover.clone();
    }
    if let Some(shape) = &patch.shape {
        folder.shape = shape.clone();
    }
    if let Some(layout) = patch.layout {
        folder.layout = layout;
    }
    if let Some(filter) = &patch.filter {
        folder.filter = filter.clone();
    }
    if let Some(collection_id) = &patch.collection_id {
        folder.collection_id = collection_id.clone();
    }
    if let Some(window_state) = patch.window_state {
        folder.window_state = window_state;
    }
    if let Some(order) = patch.sort_order {
        folder.sort_order = order;
    }

    put(db, &folder)?;
    Ok(folder)
}

pub fn delete(db: &Db, id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute("DELETE FROM folders WHERE id = ?1", params![id])? > 0)
}

pub fn count(db: &Db) -> Result<i64> {
    let conn = db.conn();
    Ok(conn.query_row("SELECT count(*) FROM folders", [], |r| r.get(0))?)
}

/// The `EntryFilter` a smart folder stands for, or None for other kinds.
pub fn smart_filter(folder: &Folder) -> Option<EntryFilter> {
    match folder.kind {
        FolderKind::Smart => Some(folder.filter.clone().unwrap_or_default()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EntryType, FolderWindowState, SortKey};

    fn db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    #[test]
    fn slugs_are_readable_and_collapse_punctuation() {
        assert_eq!(slugify("All games"), "all-games");
        assert_eq!(slugify("Recently played"), "recently-played");
        assert_eq!(slugify("  Work / Stuff!  "), "work-stuff");
        assert_eq!(slugify("Portal 2"), "portal-2");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn a_smart_folder_round_trips_with_its_filter() {
        let db = db();
        let created = create(
            &db,
            &NewFolder {
                label: Some("All games".into()),
                kind: Some(FolderKind::Smart),
                filter: Some(EntryFilter {
                    entry_type: Some(EntryType::Game),
                    sort: SortKey::Name,
                    ..Default::default()
                }),
                shape: Some("capsule".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            created.path, "smart:all-games",
            "readable locator, not a uuid"
        );
        let back = get(&db, &created.id).unwrap().unwrap();
        assert_eq!(back, created);
        assert!(smart_filter(&back).is_some());
        assert_eq!(
            back.filter.as_ref().unwrap().entry_type,
            Some(EntryType::Game)
        );
    }

    #[test]
    fn a_filesystem_folder_needs_a_path_and_a_collection_folder_does_not() {
        let db = db();
        assert!(matches!(
            create(
                &db,
                &NewFolder {
                    kind: Some(FolderKind::Filesystem),
                    ..Default::default()
                }
            ),
            Err(CoreError::Invalid(_))
        ));

        let disk = create(
            &db,
            &NewFolder {
                kind: Some(FolderKind::Filesystem),
                path: Some(r"C:\Games".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(disk.path, r"C:\Games");

        let collection = create(
            &db,
            &NewFolder {
                kind: Some(FolderKind::Collection),
                collection_id: Some("c1".into()),
                label: Some("Work stuff".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(collection.path, "collection:c1");
        assert_eq!(smart_filter(&collection), None);
    }

    #[test]
    fn the_editor_patch_changes_only_what_it_names() {
        let db = db();
        let folder = create(
            &db,
            &NewFolder {
                label: Some("Games".into()),
                kind: Some(FolderKind::Smart),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(folder.layout, FolderLayout::Grid);

        let edited = patch(
            &db,
            &folder.id,
            &FolderPatch {
                color: Some(Some("#3ddc84".into())),
                shape: Some(Some("tab".into())),
                layout: Some(FolderLayout::Covers),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(edited.color.as_deref(), Some("#3ddc84"));
        assert_eq!(edited.shape.as_deref(), Some("tab"));
        assert_eq!(edited.layout, FolderLayout::Covers);
        assert_eq!(
            edited.label.as_deref(),
            Some("Games"),
            "untouched by this patch"
        );
        assert_eq!(
            edited.path, folder.path,
            "the locator never moves under an edit"
        );
    }

    #[test]
    fn window_geometry_is_remembered_per_folder() {
        let db = db();
        let folder = create(
            &db,
            &NewFolder {
                label: Some("Games".into()),
                kind: Some(FolderKind::Smart),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(folder.window_state, None);

        let state = FolderWindowState {
            x: 120.0,
            y: 80.0,
            width: 900.0,
            height: 600.0,
            maximised: false,
        };
        patch(
            &db,
            &folder.id,
            &FolderPatch {
                window_state: Some(Some(state)),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            get(&db, &folder.id).unwrap().unwrap().window_state,
            Some(state)
        );
    }

    #[test]
    fn a_null_clears_a_field_and_an_absent_key_leaves_it_alone() {
        // The regression: `{ "color": null }` deserialised to `None`, which read as "unchanged",
        // so a colour or a cover could never be removed once set. Parse real JSON here, because
        // the IPC boundary is exactly where the two cases used to collapse.
        let db = db();
        let folder = create(
            &db,
            &NewFolder {
                label: Some("Games".into()),
                kind: Some(FolderKind::Smart),
                ..Default::default()
            },
        )
        .unwrap();
        let set: FolderPatch =
            serde_json::from_str(r##"{ "color": "#3ddc84", "cover": "C:/covers/games.png" }"##)
                .unwrap();
        patch(&db, &folder.id, &set).unwrap();

        let clear: FolderPatch = serde_json::from_str(r#"{ "color": null }"#).unwrap();
        let cleared = patch(&db, &folder.id, &clear).unwrap();

        assert_eq!(cleared.color, None, "an explicit null clears");
        assert_eq!(
            cleared.cover.as_deref(),
            Some("C:/covers/games.png"),
            "an absent key leaves alone"
        );
        assert_eq!(cleared.label.as_deref(), Some("Games"));
        // Stored, not just returned.
        assert_eq!(get(&db, &folder.id).unwrap().unwrap().color, None);
    }

    #[test]
    fn the_three_patch_states_deserialise_distinctly() {
        let absent: FolderPatch = serde_json::from_str("{}").unwrap();
        let null: FolderPatch = serde_json::from_str(r#"{ "cover": null }"#).unwrap();
        let set: FolderPatch = serde_json::from_str(r#"{ "cover": "x.png" }"#).unwrap();
        assert_eq!(absent.cover, None);
        assert_eq!(null.cover, Some(None));
        assert_eq!(set.cover, Some(Some("x.png".into())));
    }

    #[test]
    fn deleting_reports_whether_anything_went() {
        let db = db();
        let f = create(
            &db,
            &NewFolder {
                kind: Some(FolderKind::Smart),
                label: Some("X".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(count(&db).unwrap(), 1);
        assert!(delete(&db, &f.id).unwrap());
        assert!(!delete(&db, &f.id).unwrap());
        assert_eq!(count(&db).unwrap(), 0);
    }
}
