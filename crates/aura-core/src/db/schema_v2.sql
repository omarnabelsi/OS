-- Aura Shell schema v2: the desktop surface.
--
-- Strictly additive. Nothing here drops or rewrites a v1 table, so entries, artwork, stats and
-- the playtime history they carry are untouched - see docs/RISKS.md R8, and the backup that
-- `Db::backup_before_migration` takes before this runs.

CREATE TABLE IF NOT EXISTS desktops (
  id            TEXT PRIMARY KEY,            -- uuid v4
  name          TEXT NOT NULL,
  wallpaper     TEXT,                        -- JSON WallpaperSetting; NULL = inherit settings/theme
  grid_settings TEXT NOT NULL,               -- JSON GridSettings
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- Positions are grid CELLS, not pixels, so an arrangement made at 1080p survives a 4K monitor.
CREATE TABLE IF NOT EXISTS desktop_items (
  id             TEXT PRIMARY KEY,
  desktop_id     TEXT NOT NULL REFERENCES desktops(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,              -- shortcut | folder | widget | separator
  target_id      TEXT,                       -- entries.id | folders.id | widget id
  x              INTEGER NOT NULL DEFAULT 0,
  y              INTEGER NOT NULL DEFAULT 0,
  width          INTEGER NOT NULL DEFAULT 1,
  height         INTEGER NOT NULL DEFAULT 1,
  label_override TEXT,
  icon_override  TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_desktop_items_desktop ON desktop_items(desktop_id);

-- Only pinned/structural items live here. "Running" is derived from open windows and live
-- LaunchSessions, never stored, so it can never go stale.
CREATE TABLE IF NOT EXISTS taskbar_items (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,               -- pinned | system_area | launcher
  target_id     TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- The folder columns the desktop needs are NOT here on purpose.
--
-- `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS`, so replaying it fails with "duplicate
-- column name" - and a migration interrupted between the ALTERs and the `user_version` bump
-- would then fail on every subsequent start, permanently. `Db::add_missing_columns` in mod.rs
-- adds them one at a time after checking `PRAGMA table_info`, which is replayable.
--
-- The columns it adds: shape, kind, collection_id, filter, window_state.
-- `folders.path` stays NOT NULL UNIQUE, so virtual folders use a scheme prefix as their
-- locator: `smart:all-games`, `collection:<uuid>`.
