//! `themes` repository: which theme packages are installed/enabled and the user's token
//! overrides. In V1 discovery is filesystem-driven; this table only stores state.

use rusqlite::{params, Row};
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

fn row_to_theme(row: &Row<'_>) -> rusqlite::Result<ThemeRow> {
    let raw: Option<String> = row.get(3)?;
    let token_overrides = match raw {
        Some(s) => serde_json::from_str(&s).ok(),
        None => None,
    };
    Ok(ThemeRow {
        id: row.get(0)?,
        version: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        token_overrides,
        installed_at: row.get(4)?,
    })
}

pub fn list(db: &Db) -> Result<Vec<ThemeRow>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, version, enabled, token_overrides, installed_at FROM themes ORDER BY id",
    )?;
    let rows = stmt.query_map([], row_to_theme)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert(db: &Db, row: &ThemeRow) -> Result<()> {
    let overrides = match &row.token_overrides {
        Some(v) => Some(serde_json::to_string(v)?),
        None => None,
    };
    let conn = db.conn();
    conn.execute(
        "INSERT INTO themes (id, version, enabled, token_overrides, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           version         = excluded.version,
           enabled         = excluded.enabled,
           token_overrides = excluded.token_overrides",
        params![
            row.id,
            row.version,
            row.enabled as i64,
            overrides,
            row.installed_at
        ],
    )?;
    Ok(())
}

pub fn set_enabled(db: &Db, id: &str, enabled: bool) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "UPDATE themes SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    Ok(())
}

pub fn set_token_overrides(db: &Db, id: &str, overrides: Option<&serde_json::Value>) -> Result<()> {
    let raw = match overrides {
        Some(v) => Some(serde_json::to_string(v)?),
        None => None,
    };
    let conn = db.conn();
    conn.execute(
        "UPDATE themes SET token_overrides = ?2 WHERE id = ?1",
        params![id, raw],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    fn row(id: &str) -> ThemeRow {
        ThemeRow {
            id: id.into(),
            version: "1.0.0".into(),
            enabled: true,
            token_overrides: None,
            installed_at: 100,
        }
    }

    #[test]
    fn upsert_list_and_flags() {
        let db = db();
        upsert(&db, &row("aura-default")).unwrap();
        upsert(&db, &row("neon")).unwrap();
        let all = list(&db).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "aura-default");

        set_enabled(&db, "neon", false).unwrap();
        assert!(
            !list(&db)
                .unwrap()
                .iter()
                .find(|r| r.id == "neon")
                .unwrap()
                .enabled
        );

        let overrides = serde_json::json!({ "color": { "accent": "#ff0000" } });
        set_token_overrides(&db, "neon", Some(&overrides)).unwrap();
        let neon = list(&db)
            .unwrap()
            .into_iter()
            .find(|r| r.id == "neon")
            .unwrap();
        assert_eq!(neon.token_overrides, Some(overrides));

        set_token_overrides(&db, "neon", None).unwrap();
        let neon = list(&db)
            .unwrap()
            .into_iter()
            .find(|r| r.id == "neon")
            .unwrap();
        assert_eq!(neon.token_overrides, None);
    }

    #[test]
    fn upsert_replaces_version() {
        let db = db();
        upsert(&db, &row("a")).unwrap();
        upsert(
            &db,
            &ThemeRow {
                version: "2.0.0".into(),
                ..row("a")
            },
        )
        .unwrap();
        let all = list(&db).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].version, "2.0.0");
    }
}
