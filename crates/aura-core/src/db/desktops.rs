//! `desktops` and `desktop_items` repositories.
//!
//! Kept in one file because the two tables are a parent and its children and are never read
//! apart: loading a desktop without its items is not a useful operation.

use rusqlite::{params, OptionalExtension, Row};

use super::Db;
use crate::error::{CoreError, Result};
use crate::model::{Desktop, DesktopItem, DesktopItemKind, DesktopItemPatch, NewDesktopItem};

fn row_to_desktop(row: &Row<'_>) -> rusqlite::Result<Desktop> {
    let wallpaper: Option<String> = row.get(2)?;
    let grid: String = row.get(3)?;
    Ok(Desktop {
        id: row.get(0)?,
        name: row.get(1)?,
        // A wallpaper or grid blob we cannot parse is treated as absent rather than fatal: a
        // desktop that renders with defaults beats a shell that will not start.
        wallpaper: wallpaper.and_then(|w| serde_json::from_str(&w).ok()),
        grid: serde_json::from_str(&grid).unwrap_or_default(),
        sort_order: row.get(4)?,
    })
}

const DESKTOP_COLS: &str = "id, name, wallpaper, grid_settings, sort_order";

pub fn list(db: &Db) -> Result<Vec<Desktop>> {
    let conn = db.conn();
    let sql = format!("SELECT {DESKTOP_COLS} FROM desktops ORDER BY sort_order ASC, name ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_desktop)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get(db: &Db, id: &str) -> Result<Option<Desktop>> {
    let conn = db.conn();
    let sql = format!("SELECT {DESKTOP_COLS} FROM desktops WHERE id = ?1");
    Ok(conn
        .query_row(&sql, params![id], row_to_desktop)
        .optional()?)
}

pub fn upsert(db: &Db, desktop: &Desktop) -> Result<()> {
    let wallpaper = match &desktop.wallpaper {
        Some(w) => Some(serde_json::to_string(w)?),
        None => None,
    };
    let grid = serde_json::to_string(&desktop.grid)?;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO desktops (id, name, wallpaper, grid_settings, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           name          = excluded.name,
           wallpaper     = excluded.wallpaper,
           grid_settings = excluded.grid_settings,
           sort_order    = excluded.sort_order",
        params![
            desktop.id,
            desktop.name,
            wallpaper,
            grid,
            desktop.sort_order
        ],
    )?;
    Ok(())
}

pub fn delete(db: &Db, id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute("DELETE FROM desktops WHERE id = ?1", params![id])? > 0)
}

pub fn count(db: &Db) -> Result<i64> {
    let conn = db.conn();
    Ok(conn.query_row("SELECT count(*) FROM desktops", [], |r| r.get(0))?)
}

// ---- items ---------------------------------------------------------------------------------

const ITEM_COLS: &str = "id, desktop_id, kind, target_id, x, y, width, height, \
                         label_override, icon_override, sort_order";

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<DesktopItem> {
    let kind: String = row.get(2)?;
    Ok(DesktopItem {
        id: row.get(0)?,
        desktop_id: row.get(1)?,
        kind: DesktopItemKind::parse(&kind).unwrap_or_default(),
        target_id: row.get(3)?,
        x: row.get(4)?,
        y: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        label_override: row.get(8)?,
        icon_override: row.get(9)?,
        sort_order: row.get(10)?,
    })
}

pub fn list_items(db: &Db, desktop_id: &str) -> Result<Vec<DesktopItem>> {
    let conn = db.conn();
    let sql = format!(
        "SELECT {ITEM_COLS} FROM desktop_items WHERE desktop_id = ?1 \
         ORDER BY sort_order ASC, y ASC, x ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![desktop_id], row_to_item)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_item(db: &Db, id: &str) -> Result<Option<DesktopItem>> {
    let conn = db.conn();
    let sql = format!("SELECT {ITEM_COLS} FROM desktop_items WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_item).optional()?)
}

pub fn add_item(db: &Db, input: &NewDesktopItem) -> Result<DesktopItem> {
    if input.desktop_id.trim().is_empty() {
        return Err(CoreError::Invalid(
            "a desktop item needs a desktopId".into(),
        ));
    }
    let item = DesktopItem {
        id: uuid::Uuid::new_v4().to_string(),
        desktop_id: input.desktop_id.clone(),
        kind: input.kind.unwrap_or_default(),
        target_id: input.target_id.clone(),
        x: input.x,
        y: input.y,
        width: input.width.unwrap_or(1).max(1),
        height: input.height.unwrap_or(1).max(1),
        label_override: input.label_override.clone(),
        icon_override: input.icon_override.clone(),
        sort_order: 0,
    };
    put_item(db, &item)?;
    Ok(item)
}

pub fn put_item(db: &Db, item: &DesktopItem) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO desktop_items
           (id, desktop_id, kind, target_id, x, y, width, height, label_override, icon_override, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           desktop_id     = excluded.desktop_id,
           kind           = excluded.kind,
           target_id      = excluded.target_id,
           x              = excluded.x,
           y              = excluded.y,
           width          = excluded.width,
           height         = excluded.height,
           label_override = excluded.label_override,
           icon_override  = excluded.icon_override,
           sort_order     = excluded.sort_order",
        params![
            item.id,
            item.desktop_id,
            item.kind.as_str(),
            item.target_id,
            item.x,
            item.y,
            item.width,
            item.height,
            item.label_override,
            item.icon_override,
            item.sort_order,
        ],
    )?;
    Ok(())
}

/// Apply a partial change. Absent fields are left alone, so a drag sends only `x`/`y`.
pub fn patch_item(db: &Db, id: &str, patch: &DesktopItemPatch) -> Result<DesktopItem> {
    let mut item =
        get_item(db, id)?.ok_or_else(|| CoreError::NotFound(format!("desktop item `{id}`")))?;

    if let Some(x) = patch.x {
        item.x = x;
    }
    if let Some(y) = patch.y {
        item.y = y;
    }
    if let Some(w) = patch.width {
        item.width = w.max(1);
    }
    if let Some(h) = patch.height {
        item.height = h.max(1);
    }
    if patch.label_override.is_some() {
        item.label_override = patch.label_override.clone();
    }
    if patch.icon_override.is_some() {
        item.icon_override = patch.icon_override.clone();
    }
    if let Some(order) = patch.sort_order {
        item.sort_order = order;
    }

    put_item(db, &item)?;
    Ok(item)
}

pub fn remove_item(db: &Db, id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute("DELETE FROM desktop_items WHERE id = ?1", params![id])? > 0)
}

/// Drop every item pointing at a target that no longer exists.
///
/// Removing a game from the library must not leave a dead shortcut on the desktop, and the
/// foreign key cannot express "entries.id OR folders.id depending on kind".
pub fn prune_dangling(db: &Db) -> Result<usize> {
    let conn = db.conn();
    let n = conn.execute(
        "DELETE FROM desktop_items
         WHERE (kind = 'shortcut' AND (target_id IS NULL OR
                target_id NOT IN (SELECT id FROM entries)))
            OR (kind = 'folder'   AND (target_id IS NULL OR
                target_id NOT IN (SELECT id FROM folders)))",
        [],
    )?;
    Ok(n)
}

// ---- seeded defaults -------------------------------------------------------------------------
//
// Tracks which default items (a smart folder, a widget) have already been offered to which
// desktop - see `desktop::seed_if_empty` and docs/RISKS.md R15. A row here means "offered",
// never "present": whether the item itself survives is entirely the user's call, and this table
// does not care.

/// Whether `seed_key` has already been offered to `desktop_id`, regardless of whether the item
/// it seeded is still on the desktop.
pub fn is_seeded(db: &Db, desktop_id: &str, seed_key: &str) -> Result<bool> {
    let conn = db.conn();
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM desktop_seeded_defaults WHERE desktop_id = ?1 AND seed_key = ?2",
        params![desktop_id, seed_key],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Record that `seed_key` has been offered to `desktop_id`. Idempotent, so replaying a start that
/// crashed partway through never fails on a duplicate row.
pub fn mark_seeded(db: &Db, desktop_id: &str, seed_key: &str, seeded_at: i64) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO desktop_seeded_defaults (desktop_id, seed_key, seeded_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(desktop_id, seed_key) DO NOTHING",
        params![desktop_id, seed_key, seeded_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::settings::WallpaperSetting;
    use crate::model::GridSettings;

    fn db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    fn desktop(id: &str) -> Desktop {
        Desktop {
            id: id.into(),
            name: "Main".into(),
            wallpaper: None,
            grid: GridSettings::default(),
            sort_order: 0,
        }
    }

    #[test]
    fn desktops_round_trip_including_the_wallpaper_override() {
        let db = db();
        assert_eq!(count(&db).unwrap(), 0);

        let mut d = desktop("d1");
        d.wallpaper = Some(WallpaperSetting::Color {
            hex: "#101014".into(),
        });
        upsert(&db, &d).unwrap();
        assert_eq!(get(&db, "d1").unwrap().unwrap(), d);

        // Upsert is an update, not a duplicate.
        d.name = "Work".into();
        upsert(&db, &d).unwrap();
        assert_eq!(count(&db).unwrap(), 1);
        assert_eq!(get(&db, "d1").unwrap().unwrap().name, "Work");

        assert!(delete(&db, "d1").unwrap());
        assert!(!delete(&db, "d1").unwrap());
    }

    #[test]
    fn a_grid_blob_we_cannot_parse_falls_back_to_defaults() {
        let db = db();
        upsert(&db, &desktop("d1")).unwrap();
        db.conn()
            .execute(
                "UPDATE desktops SET grid_settings = 'not json' WHERE id = 'd1'",
                [],
            )
            .unwrap();
        // Renders with defaults rather than refusing to load the desktop at all.
        assert_eq!(
            get(&db, "d1").unwrap().unwrap().grid,
            GridSettings::default()
        );
    }

    #[test]
    fn items_are_scoped_to_their_desktop_and_ordered() {
        let db = db();
        upsert(&db, &desktop("d1")).unwrap();
        upsert(
            &db,
            &Desktop {
                id: "d2".into(),
                ..desktop("d2")
            },
        )
        .unwrap();

        for (desktop_id, x, y) in [("d1", 1, 1), ("d1", 0, 0), ("d2", 5, 5)] {
            add_item(
                &db,
                &NewDesktopItem {
                    desktop_id: desktop_id.into(),
                    x,
                    y,
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let one = list_items(&db, "d1").unwrap();
        assert_eq!(one.len(), 2);
        assert_eq!((one[0].x, one[0].y), (0, 0), "reading order: top row first");
        assert_eq!(list_items(&db, "d2").unwrap().len(), 1);

        // Deleting a desktop takes its items with it.
        delete(&db, "d1").unwrap();
        assert!(list_items(&db, "d1").unwrap().is_empty());
    }

    #[test]
    fn a_patch_touches_only_what_it_names() {
        let db = db();
        upsert(&db, &desktop("d1")).unwrap();
        let item = add_item(
            &db,
            &NewDesktopItem {
                desktop_id: "d1".into(),
                x: 2,
                y: 3,
                label_override: Some("Mine".into()),
                ..Default::default()
            },
        )
        .unwrap();

        // What a drag sends: position only.
        let moved = patch_item(
            &db,
            &item.id,
            &DesktopItemPatch {
                x: Some(7),
                y: Some(9),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((moved.x, moved.y), (7, 9));
        assert_eq!(
            moved.label_override.as_deref(),
            Some("Mine"),
            "the label is untouched"
        );

        // A zero or negative span would make an item unclickable.
        let squashed = patch_item(
            &db,
            &item.id,
            &DesktopItemPatch {
                width: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(squashed.width, 1);

        assert!(matches!(
            patch_item(&db, "nope", &DesktopItemPatch::default()),
            Err(CoreError::NotFound(_))
        ));
    }

    #[test]
    fn pruning_removes_shortcuts_whose_target_is_gone() {
        let db = db();
        upsert(&db, &desktop("d1")).unwrap();
        db.conn()
            .execute(
                "INSERT INTO entries (id, name, type, source, launch, created_at, updated_at)
                 VALUES ('e1', 'Portal 2', 'game', 'steam', '{}', 1, 1)",
                [],
            )
            .unwrap();

        let alive = add_item(
            &db,
            &NewDesktopItem {
                desktop_id: "d1".into(),
                kind: Some(DesktopItemKind::Shortcut),
                target_id: Some("e1".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_item(
            &db,
            &NewDesktopItem {
                desktop_id: "d1".into(),
                kind: Some(DesktopItemKind::Shortcut),
                target_id: Some("gone".into()),
                ..Default::default()
            },
        )
        .unwrap();
        // A widget has no row to point at and must survive pruning.
        add_item(
            &db,
            &NewDesktopItem {
                desktop_id: "d1".into(),
                kind: Some(DesktopItemKind::Widget),
                target_id: Some("clock".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(prune_dangling(&db).unwrap(), 1);
        let left = list_items(&db, "d1").unwrap();
        assert_eq!(left.len(), 2);
        assert!(left.iter().any(|i| i.id == alive.id));
        assert!(left.iter().any(|i| i.kind == DesktopItemKind::Widget));
    }

    #[test]
    fn a_seed_key_is_offered_at_most_once_per_desktop() {
        let db = db();
        upsert(&db, &desktop("d1")).unwrap();
        upsert(
            &db,
            &Desktop {
                id: "d2".into(),
                ..desktop("d2")
            },
        )
        .unwrap();

        assert!(!is_seeded(&db, "d1", "widget.clock").unwrap());

        mark_seeded(&db, "d1", "widget.clock", 100).unwrap();
        assert!(is_seeded(&db, "d1", "widget.clock").unwrap());
        // A different desktop, or a different key, is untouched.
        assert!(!is_seeded(&db, "d2", "widget.clock").unwrap());
        assert!(!is_seeded(&db, "d1", "widget.now-playing").unwrap());

        // Replaying the mark (a crash-and-retry) must not fail on the primary key.
        mark_seeded(&db, "d1", "widget.clock", 200).unwrap();
        assert!(is_seeded(&db, "d1", "widget.clock").unwrap());

        // Deleting the desktop takes its seeded-defaults rows with it, the same as its items.
        delete(&db, "d1").unwrap();
        upsert(&db, &desktop("d1")).unwrap();
        assert!(
            !is_seeded(&db, "d1", "widget.clock").unwrap(),
            "a new desktop that reuses an old id starts with a clean slate"
        );
    }
}
