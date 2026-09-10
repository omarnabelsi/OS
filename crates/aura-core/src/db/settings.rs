//! Key-value settings repository. The typed [`Settings`] document lives under one key;
//! `get_raw` / `set_raw` are for everything else (window geometry, last screen, ...).

use rusqlite::{params, OptionalExtension};

use super::Db;
use crate::config::settings::Settings;
use crate::error::Result;

pub const SETTINGS_KEY: &str = "core.settings";

pub fn load(db: &Db) -> Result<Option<Settings>> {
    match get_raw(db, SETTINGS_KEY)? {
        Some(v) => Ok(Some(serde_json::from_value(v)?)),
        None => Ok(None),
    }
}

pub fn save(db: &Db, settings: &Settings) -> Result<()> {
    set_raw(db, SETTINGS_KEY, &serde_json::to_value(settings)?)
}

pub fn get_raw(db: &Db, key: &str) -> Result<Option<serde_json::Value>> {
    let conn = db.conn();
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    match raw {
        Some(s) => Ok(Some(serde_json::from_str(&s)?)),
        None => Ok(None),
    }
}

pub fn set_raw(db: &Db, key: &str, value: &serde_json::Value) -> Result<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(value)?],
    )?;
    Ok(())
}

/// Export every key for backup / sync.
pub fn export_all(db: &Db) -> Result<serde_json::Map<String, serde_json::Value>> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let mut out = serde_json::Map::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        out.insert(k, serde_json::from_str(&v)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_load_settings() {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap();
        assert!(load(&db).unwrap().is_none());
        let s = Settings {
            ui_scale: 1.5,
            ..Default::default()
        };
        save(&db, &s).unwrap();
        assert_eq!(load(&db).unwrap().unwrap(), s);
        set_raw(&db, "ui.lastScreen", &serde_json::json!("games")).unwrap();
        assert_eq!(export_all(&db).unwrap().len(), 2);
    }
}
