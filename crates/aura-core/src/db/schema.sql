-- Aura Shell schema v1. Mirrors the "Data model (SQLite)" table in docs/PLAN.md.

CREATE TABLE IF NOT EXISTS entries (
  id            TEXT PRIMARY KEY,            -- uuid v4
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,               -- game | app | link | folder
  source        TEXT NOT NULL,               -- steam | epic | gog | ea | uwp | manual
  source_id     TEXT,                        -- store id (steam appid ...)
  launch        TEXT NOT NULL,               -- JSON LaunchSpec
  install_path  TEXT,
  install_size  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS artwork (
  entry_id      TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  grid          TEXT,
  hero          TEXT,
  logo          TEXT,
  icon          TEXT,
  source        TEXT,                        -- steamgriddb | steam_cdn | user
  user_override INTEGER NOT NULL DEFAULT 0,
  fetched_at    INTEGER
);

CREATE TABLE IF NOT EXISTS stats (
  entry_id      TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  playtime_secs INTEGER NOT NULL DEFAULT 0,
  launch_count  INTEGER NOT NULL DEFAULT 0,
  last_played   INTEGER,
  favourite     INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collections (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'manual', -- manual | smart
  filter        TEXT,                            -- JSON EntryFilter for smart collections
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  entry_id      TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, entry_id)
);

-- V2: pinned locations for the file browser and their per-folder skin.
CREATE TABLE IF NOT EXISTS folders (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  label         TEXT,
  color         TEXT,
  icon          TEXT,
  cover         TEXT,
  layout        TEXT,                        -- grid | list | covers
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS themes (
  id            TEXT PRIMARY KEY,
  version       TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  token_overrides TEXT,                      -- JSON, user tweaks on top of tokens.json
  installed_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL                -- JSON
);
