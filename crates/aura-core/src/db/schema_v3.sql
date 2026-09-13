-- Aura Shell schema v3: which default items have already been offered to which desktop.
--
-- Strictly additive, like v2. Lets a default added after a desktop already existed (a widget, a
-- smart folder) reach that desktop on its next start, exactly once, without resurrecting one the
-- user deleted - see `desktop::seed_if_empty` and docs/RISKS.md R15.

CREATE TABLE IF NOT EXISTS desktop_seeded_defaults (
  desktop_id  TEXT NOT NULL REFERENCES desktops(id) ON DELETE CASCADE,
  seed_key    TEXT NOT NULL,     -- stable id per default item, e.g. "widget.clock" - never a
                                  -- display name, and never removed when the item itself is
  seeded_at   INTEGER NOT NULL,
  PRIMARY KEY (desktop_id, seed_key)
);
