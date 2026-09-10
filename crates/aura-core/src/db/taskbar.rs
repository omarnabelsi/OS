//! `taskbar_items` repository.
//!
//! Only pinned and structural items are stored. Whether something is *running* is derived at
//! render time from open windows and the process service's live sessions - persisting it would
//! guarantee a stale taskbar after any crash.

use rusqlite::{params, Row};

use super::Db;
use crate::error::Result;
use crate::model::{TaskbarItem, TaskbarItemKind};

fn kind_str(kind: TaskbarItemKind) -> &'static str {
    match kind {
        TaskbarItemKind::Pinned => "pinned",
        TaskbarItemKind::SystemArea => "system_area",
        TaskbarItemKind::Launcher => "launcher",
    }
}

fn parse_kind(s: &str) -> Option<TaskbarItemKind> {
    match s {
        "pinned" => Some(TaskbarItemKind::Pinned),
        "system_area" => Some(TaskbarItemKind::SystemArea),
        "launcher" => Some(TaskbarItemKind::Launcher),
        _ => None,
    }
}

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<TaskbarItem> {
    let kind: String = row.get(1)?;
    Ok(TaskbarItem {
        id: row.get(0)?,
        kind: parse_kind(&kind).unwrap_or(TaskbarItemKind::Pinned),
        target_id: row.get(2)?,
        sort_order: row.get(3)?,
    })
}

pub fn list(db: &Db) -> Result<Vec<TaskbarItem>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, kind, target_id, sort_order FROM taskbar_items ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map([], row_to_item)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn put(db: &Db, item: &TaskbarItem) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO taskbar_items (id, kind, target_id, sort_order)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           kind       = excluded.kind,
           target_id  = excluded.target_id,
           sort_order = excluded.sort_order",
        params![
            item.id,
            kind_str(item.kind),
            item.target_id,
            item.sort_order
        ],
    )?;
    Ok(())
}

/// Pin `target_id`, or do nothing if it is already pinned. Returns the item either way.
pub fn pin(db: &Db, target_id: &str) -> Result<TaskbarItem> {
    if let Some(existing) = list(db)?
        .into_iter()
        .find(|i| i.kind == TaskbarItemKind::Pinned && i.target_id.as_deref() == Some(target_id))
    {
        return Ok(existing);
    }
    let next_order = list(db)?.iter().map(|i| i.sort_order).max().unwrap_or(-1) + 1;
    let item = TaskbarItem {
        id: uuid::Uuid::new_v4().to_string(),
        kind: TaskbarItemKind::Pinned,
        target_id: Some(target_id.to_string()),
        sort_order: next_order,
    };
    put(db, &item)?;
    Ok(item)
}

/// Unpin by target. Returns true when something was removed.
pub fn unpin(db: &Db, target_id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute(
        "DELETE FROM taskbar_items WHERE kind = 'pinned' AND target_id = ?1",
        params![target_id],
    )? > 0)
}

pub fn remove(db: &Db, id: &str) -> Result<bool> {
    let conn = db.conn();
    Ok(conn.execute("DELETE FROM taskbar_items WHERE id = ?1", params![id])? > 0)
}

/// Rewrite the order in one pass, for a drag-to-reorder.
pub fn reorder(db: &Db, ids_in_order: &[String]) -> Result<()> {
    let conn = db.conn();
    for (i, id) in ids_in_order.iter().enumerate() {
        conn.execute(
            "UPDATE taskbar_items SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

pub fn count(db: &Db) -> Result<i64> {
    let conn = db.conn();
    Ok(conn.query_row("SELECT count(*) FROM taskbar_items", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    #[test]
    fn pinning_is_idempotent_and_ordered() {
        let db = db();
        let first = pin(&db, "e1").unwrap();
        let again = pin(&db, "e1").unwrap();
        assert_eq!(
            first.id, again.id,
            "pinning twice must not produce two buttons"
        );
        assert_eq!(count(&db).unwrap(), 1);

        let second = pin(&db, "e2").unwrap();
        assert!(
            second.sort_order > first.sort_order,
            "new pins go on the end"
        );

        assert!(unpin(&db, "e1").unwrap());
        assert!(!unpin(&db, "e1").unwrap());
        assert_eq!(count(&db).unwrap(), 1);
    }

    #[test]
    fn structural_items_coexist_with_pins_and_survive_unpinning() {
        let db = db();
        put(
            &db,
            &TaskbarItem {
                id: "launcher".into(),
                kind: TaskbarItemKind::Launcher,
                target_id: None,
                sort_order: -1,
            },
        )
        .unwrap();
        pin(&db, "e1").unwrap();

        // Unpinning an entry must not disturb the launcher button.
        unpin(&db, "e1").unwrap();
        let left = list(&db).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].kind, TaskbarItemKind::Launcher);
    }

    #[test]
    fn reorder_rewrites_positions() {
        let db = db();
        let a = pin(&db, "a").unwrap();
        let b = pin(&db, "b").unwrap();
        let c = pin(&db, "c").unwrap();

        reorder(&db, &[c.id.clone(), a.id.clone(), b.id.clone()]).unwrap();
        let order: Vec<Option<String>> = list(&db)
            .unwrap()
            .into_iter()
            .map(|i| i.target_id)
            .collect();
        assert_eq!(
            order,
            vec![Some("c".into()), Some("a".into()), Some("b".into())]
        );
    }
}
