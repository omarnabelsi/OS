//! Desktop service: the surface, what sits on it, and what a folder resolves to.
//!
//! This is the model layer for the shell-as-desktop work. It owns three things:
//!   - desktops and the items placed on them (positions in grid cells, never pixels);
//!   - folders, including the two virtual kinds - a *collection* of hand-picked entries and a
//!     *smart* folder standing for a saved `EntryFilter`;
//!   - the seeded default arrangement, so a first run shows the user's library laid out rather
//!     than an empty wallpaper (docs/RISKS.md - discoverability).
//!
//! Window geometry deliberately does **not** live here beyond `folders.window_state`. Live
//! window state belongs to the UI; writing a drag frame to SQLite would be absurd.

use crate::db;
use crate::error::{CoreError, Result};
use crate::events::CoreEvent;
use crate::model::*;
use crate::Core;

/// Locators for the folders the first run seeds. Stable so a reinstall recognises them.
pub const SEEDED_GAMES: &str = "smart:games";
pub const SEEDED_APPS: &str = "smart:apps";
pub const SEEDED_FAVOURITES: &str = "smart:favourites";
pub const SEEDED_RECENT: &str = "smart:recently-played";

/// Widget ids. A `DesktopItemKind::Widget` addresses its widget by id in `target_id`, and the UI
/// decides what to draw - the core neither knows nor cares what a clock looks like.
pub const WIDGET_CLOCK: &str = "clock";
pub const WIDGET_NOW_PLAYING: &str = "now-playing";

/*
 * Keys into `desktop_seeded_defaults` (docs/RISKS.md R15) - stable ids for "has this default been
 * offered to this desktop", never a display name (which can change) and never the item itself
 * (which the user gets to delete). Prefixed by kind so a future default with the same word in a
 * different slot - a `widget.games` next to `folder.smart-games`, say - cannot collide.
 */
const SEED_KEY_GAMES: &str = "folder.smart-games";
const SEED_KEY_APPS: &str = "folder.smart-apps";
const SEED_KEY_FAVOURITES: &str = "folder.smart-favourites";
const SEED_KEY_RECENT: &str = "folder.smart-recently-played";
const SEED_KEY_WIDGET_CLOCK: &str = "widget.clock";
const SEED_KEY_WIDGET_NOW_PLAYING: &str = "widget.now-playing";

fn emit_changed(core: &Core, reason: &str) {
    core.sink.emit(CoreEvent::DesktopUpdated(DesktopUpdated {
        reason: reason.to_string(),
    }));
}

// ---- desktops --------------------------------------------------------------------------------

pub fn list_desktops(core: &Core) -> Result<Vec<Desktop>> {
    db::desktops::list(&core.db)
}

pub fn get_desktop(core: &Core, id: &str) -> Result<Option<Desktop>> {
    db::desktops::get(&core.db, id)
}

pub fn create_desktop(core: &Core, name: &str) -> Result<Desktop> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("a desktop needs a name".into()));
    }
    let existing = db::desktops::count(&core.db)?;
    let desktop = Desktop {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        wallpaper: None,
        grid: GridSettings::default(),
        sort_order: existing,
    };
    db::desktops::upsert(&core.db, &desktop)?;
    emit_changed(core, "desktop_created");
    Ok(desktop)
}

pub fn update_desktop(core: &Core, desktop: &Desktop) -> Result<Desktop> {
    db::desktops::upsert(&core.db, desktop)?;
    emit_changed(core, "desktop_updated");
    Ok(desktop.clone())
}

pub fn delete_desktop(core: &Core, id: &str) -> Result<()> {
    // Leaving the user with no surface at all is not a state the UI can render.
    if db::desktops::count(&core.db)? <= 1 {
        return Err(CoreError::Invalid(
            "the last desktop cannot be deleted".into(),
        ));
    }
    if !db::desktops::delete(&core.db, id)? {
        return Err(CoreError::NotFound(format!("desktop `{id}`")));
    }
    emit_changed(core, "desktop_deleted");
    Ok(())
}

// ---- items -----------------------------------------------------------------------------------

pub fn list_items(core: &Core, desktop_id: &str) -> Result<Vec<DesktopItem>> {
    db::desktops::list_items(&core.db, desktop_id)
}

pub fn add_item(core: &Core, input: NewDesktopItem) -> Result<DesktopItem> {
    if db::desktops::get(&core.db, &input.desktop_id)?.is_none() {
        return Err(CoreError::NotFound(format!(
            "desktop `{}`",
            input.desktop_id
        )));
    }
    let item = db::desktops::add_item(&core.db, &input)?;
    emit_changed(core, "item_added");
    Ok(item)
}

pub fn update_item(core: &Core, id: &str, patch: DesktopItemPatch) -> Result<DesktopItem> {
    let item = db::desktops::patch_item(&core.db, id, &patch)?;
    emit_changed(core, "item_moved");
    Ok(item)
}

pub fn remove_item(core: &Core, id: &str) -> Result<()> {
    if !db::desktops::remove_item(&core.db, id)? {
        return Err(CoreError::NotFound(format!("desktop item `{id}`")));
    }
    emit_changed(core, "item_removed");
    Ok(())
}

// ---- folders ---------------------------------------------------------------------------------

pub fn list_folders(core: &Core) -> Result<Vec<Folder>> {
    db::folders::list(&core.db)
}

pub fn get_folder(core: &Core, id: &str) -> Result<Option<Folder>> {
    db::folders::get(&core.db, id)
}

pub fn create_folder(core: &Core, input: NewFolder) -> Result<Folder> {
    let folder = db::folders::create(&core.db, &input)?;
    emit_changed(core, "folder_created");
    Ok(folder)
}

pub fn update_folder(core: &Core, id: &str, patch: FolderPatch) -> Result<Folder> {
    let folder = db::folders::patch(&core.db, id, &patch)?;
    emit_changed(core, "folder_updated");
    Ok(folder)
}

/// Copy a user-chosen image into the artwork cache and make it a folder's cover.
///
/// Reuses `artwork::cache` rather than growing a second image cache: the file lands beside an
/// entry's user-supplied artwork, at `<artwork_dir>/folder-<id>/grid-user-<hash>.<ext>`.
///
/// The copy is the point. A cover pointing at the user's own file would break the moment they
/// moved or renamed it, and the webview can only load what the asset scope allows - the cache is
/// inside that scope, an arbitrary folder on disk is not.
pub fn set_folder_cover(core: &Core, id: &str, source: &str) -> Result<Folder> {
    if db::folders::get(&core.db, id)?.is_none() {
        return Err(CoreError::NotFound(format!("folder `{id}`")));
    }

    let source_file = std::path::Path::new(source.trim());
    if !source_file.is_file() {
        return Err(CoreError::NotFound(format!("`{source}` is not a file")));
    }
    let bytes = std::fs::metadata(source_file)?.len();
    if bytes > crate::artwork::cache::MAX_BYTES {
        return Err(CoreError::Invalid(format!(
            "`{source}` is {bytes} bytes, over the {} byte limit",
            crate::artwork::cache::MAX_BYTES
        )));
    }

    // A folder is not an entry, so it gets its own scope in the cache rather than borrowing an
    // entry's id - nothing can then collide with real artwork.
    let dest = crate::artwork::cache::override_path(
        &core.paths.artwork_dir,
        &format!("folder-{id}"),
        crate::model::ArtworkKind::Grid,
        source_file,
    );
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source_file, &dest)?;

    let folder = db::folders::patch(
        &core.db,
        id,
        &FolderPatch {
            cover: Some(Some(dest.display().to_string())),
            ..Default::default()
        },
    )?;
    emit_changed(core, "folder_cover");
    Ok(folder)
}

/// Copy a user-chosen image into the artwork cache and make it a folder's icon.
///
/// The read side already tries `folders.icon` as a theme icon key first and falls back to
/// resolving it as a path (`FolderGlyph`, `Folder`) - this is the write side of that: same column,
/// same cache the cover picker copies into, just `ArtworkKind::Icon` instead of `Grid` so the two
/// never collide in `<artwork_dir>/folder-<id>/`. The copy exists for the same reason a cover's
/// does - a path pointing straight at the user's own file breaks the moment they move or rename it.
pub fn set_folder_icon(core: &Core, id: &str, source: &str) -> Result<Folder> {
    if db::folders::get(&core.db, id)?.is_none() {
        return Err(CoreError::NotFound(format!("folder `{id}`")));
    }

    let source_file = std::path::Path::new(source.trim());
    if !source_file.is_file() {
        return Err(CoreError::NotFound(format!("`{source}` is not a file")));
    }
    let bytes = std::fs::metadata(source_file)?.len();
    if bytes > crate::artwork::cache::MAX_BYTES {
        return Err(CoreError::Invalid(format!(
            "`{source}` is {bytes} bytes, over the {} byte limit",
            crate::artwork::cache::MAX_BYTES
        )));
    }

    let dest = crate::artwork::cache::override_path(
        &core.paths.artwork_dir,
        &format!("folder-{id}"),
        crate::model::ArtworkKind::Icon,
        source_file,
    );
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source_file, &dest)?;

    let folder = db::folders::patch(
        &core.db,
        id,
        &FolderPatch {
            icon: Some(Some(dest.display().to_string())),
            ..Default::default()
        },
    )?;
    emit_changed(core, "folder_icon");
    Ok(folder)
}

pub fn delete_folder(core: &Core, id: &str) -> Result<()> {
    if !db::folders::delete(&core.db, id)? {
        return Err(CoreError::NotFound(format!("folder `{id}`")));
    }
    // The desktop item pointing at it would otherwise open nothing.
    db::desktops::prune_dangling(&core.db)?;
    emit_changed(core, "folder_deleted");
    Ok(())
}

/// What is inside a folder, ready to render.
///
/// - **smart**: run the saved `EntryFilter` against the library.
/// - **collection**: the hand-picked members, in their stored order.
/// - **filesystem**: empty for now. The file browser is V2 (PLAN.md section 05); the folder can
///   exist and be skinned before it can be browsed, which is why this returns Ok rather than an
///   error the UI would have to special-case.
pub fn folder_contents(core: &Core, id: &str) -> Result<Vec<LibraryItem>> {
    let folder = db::folders::get(&core.db, id)?
        .ok_or_else(|| CoreError::NotFound(format!("folder `{id}`")))?;

    match folder.kind {
        FolderKind::Smart => {
            let filter = folder.filter.unwrap_or_default();
            crate::library::list(core, &filter)
        }
        FolderKind::Collection => {
            let Some(collection_id) = folder.collection_id.as_deref() else {
                return Ok(Vec::new());
            };
            let ids = db::entries::collection_entry_ids(&core.db, collection_id)?;
            let mut out = Vec::new();
            for entry_id in ids {
                if let Some(item) = crate::library::get(core, &entry_id)? {
                    out.push(item);
                }
            }
            Ok(out)
        }
        FolderKind::Filesystem => Ok(Vec::new()),
    }
}

// ---- taskbar ---------------------------------------------------------------------------------

pub fn list_taskbar(core: &Core) -> Result<Vec<TaskbarItem>> {
    db::taskbar::list(&core.db)
}

pub fn pin_to_taskbar(core: &Core, target_id: &str) -> Result<TaskbarItem> {
    let item = db::taskbar::pin(&core.db, target_id)?;
    emit_changed(core, "taskbar_pinned");
    Ok(item)
}

pub fn unpin_from_taskbar(core: &Core, target_id: &str) -> Result<()> {
    db::taskbar::unpin(&core.db, target_id)?;
    emit_changed(core, "taskbar_unpinned");
    Ok(())
}

pub fn reorder_taskbar(core: &Core, ids: &[String]) -> Result<()> {
    db::taskbar::reorder(&core.db, ids)?;
    emit_changed(core, "taskbar_reordered");
    Ok(())
}

// ---- seeding ---------------------------------------------------------------------------------

/// Lay out a first desktop that mirrors what the old home screen showed, and give every desktop
/// - old or new - whichever of these defaults it is still missing.
///
/// A blank customisable desktop is worse than an opinionated one: the user upgrades, opens the
/// app and must see their library, arranged. Today's three home rows become smart folders, so
/// nothing is lost and everything becomes movable.
///
/// Not "if empty" any more, despite the name (kept - `Core::seed_desktop` and every caller already
/// say "safe on every start", which stays true): a desktop that has existed for months is not
/// empty, and a default added after that is still owed to it. `desktop_seeded_defaults`
/// (docs/RISKS.md R15) is what makes running this every start safe either way - each default is
/// offered to each desktop at most once, tracked by a row's presence rather than by whether the
/// item is still there, so a user who deleted the clock does not get it back on the next restart,
/// and a fifth default added next year reaches every desktop that predates it exactly once, the
/// same way these six did on the desktops that predate *them*.
///
/// Returns the desktop only when this call is the one that created it (a real first run) - a
/// backfill onto a desktop that already existed returns `None`, the same as the old "did nothing"
/// did, so nothing that only cared about *first run* has to change.
pub fn seed_if_empty(core: &Core) -> Result<Option<Desktop>> {
    let created = if db::desktops::count(&core.db)? == 0 {
        let desktop = Desktop {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Desktop".to_string(),
            wallpaper: None,
            grid: GridSettings::default(),
            sort_order: 0,
        };
        db::desktops::upsert(&core.db, &desktop)?;
        Some(desktop)
    } else {
        None
    };

    // No desktop UI exposes more than one today, but nothing below assumes there is exactly
    // one - every desktop that exists gets the same backfill, including a second one someone
    // made by hand.
    for desktop in db::desktops::list(&core.db)? {
        seed_folder_defaults(core, &desktop.id)?;
        seed_widget_defaults(core, &desktop.id)?;
    }
    seed_taskbar(core)?;

    if created.is_some() {
        emit_changed(core, "seeded");
        tracing::info!("seeded the default desktop");
    }
    Ok(created)
}

/// The old `home.rows`, promoted into openable folders, clustered two by two on the left.
///
/// The shapes vary on purpose. A first run that used one shape for everything would make the
/// theme's other shapes look like dead settings - the shape is the most visible thing a folder
/// has, and seeing three of them is how anyone discovers the folder editor can change it. Ids
/// are per theme, and a folder whose shape the active theme does not offer falls back to that
/// theme's first, so these names costing nothing on `aura-paper` is by design.
fn seed_folder_defaults(core: &Core, desktop_id: &str) -> Result<()> {
    let defaults: [(&str, &str, &str, EntryFilter, &str, &str); 4] = [
        (
            SEED_KEY_GAMES,
            SEEDED_GAMES,
            "Games",
            EntryFilter {
                entry_type: Some(EntryType::Game),
                ..Default::default()
            },
            "games",
            "rounded",
        ),
        (
            SEED_KEY_APPS,
            SEEDED_APPS,
            "Apps",
            EntryFilter {
                entry_type: Some(EntryType::App),
                ..Default::default()
            },
            "apps",
            "capsule",
        ),
        (
            SEED_KEY_FAVOURITES,
            SEEDED_FAVOURITES,
            "Favourites",
            EntryFilter {
                favourites_only: true,
                ..Default::default()
            },
            "star",
            "tab",
        ),
        (
            SEED_KEY_RECENT,
            SEEDED_RECENT,
            "Recently played",
            EntryFilter {
                sort: SortKey::LastPlayed,
                limit: Some(24),
                ..Default::default()
            },
            "play",
            "rounded",
        ),
    ];

    /*
     * Two columns wide, not one tall.
     *
     * The design's reference is 1080p, where the grid is seven columns by three rows. A column of
     * four needed a fourth row, so on the very first launch the last folder was already pulled out
     * of place to keep it on screen - a first run that looked rearranged rather than composed. Two
     * by two fits, and still clusters left of the widgets in column five.
     */
    const SEED_COLUMNS: usize = 2;
    for (index, (seed_key, locator, label, filter, icon, shape)) in defaults.into_iter().enumerate()
    {
        if db::desktops::is_seeded(&core.db, desktop_id, seed_key)? {
            continue;
        }

        // Reuse the row if a previous partial seed left it behind, so ids stay stable.
        let folder = match db::folders::find_by_path(&core.db, locator)? {
            Some(existing) => existing,
            None => db::folders::create(
                &core.db,
                &NewFolder {
                    label: Some(label.to_string()),
                    kind: Some(FolderKind::Smart),
                    filter: Some(filter),
                    icon: Some(icon.to_string()),
                    shape: Some(shape.to_string()),
                    ..Default::default()
                },
            )?,
        };

        db::desktops::add_item(
            &core.db,
            &NewDesktopItem {
                desktop_id: desktop_id.to_string(),
                kind: Some(DesktopItemKind::Folder),
                target_id: Some(folder.id),
                x: (index % SEED_COLUMNS) as i64,
                y: (index / SEED_COLUMNS) as i64,
                ..Default::default()
            },
        )?;
        db::desktops::mark_seeded(&core.db, desktop_id, seed_key, crate::now_secs())?;
    }
    Ok(())
}

/// The widgets, holding the right-hand side.
///
/// Placed on the same grid as everything else rather than pinned to a corner: a widget is a
/// `DesktopItem` like a folder is, so it drags, snaps and survives a restart through exactly
/// the same code, and the arrangement is the user's from the first run. Column 5 of seven,
/// two cells wide, which leaves the four seeded folders clustered left with the composition
/// of the design.
fn seed_widget_defaults(core: &Core, desktop_id: &str) -> Result<()> {
    let defaults = [
        (SEED_KEY_WIDGET_CLOCK, WIDGET_CLOCK),
        (SEED_KEY_WIDGET_NOW_PLAYING, WIDGET_NOW_PLAYING),
    ];
    for (row, (seed_key, widget)) in defaults.into_iter().enumerate() {
        if db::desktops::is_seeded(&core.db, desktop_id, seed_key)? {
            continue;
        }

        db::desktops::add_item(
            &core.db,
            &NewDesktopItem {
                desktop_id: desktop_id.to_string(),
                kind: Some(DesktopItemKind::Widget),
                target_id: Some(widget.to_string()),
                x: 5,
                y: row as i64,
                width: Some(2),
                height: Some(1),
                ..Default::default()
            },
        )?;
        db::desktops::mark_seeded(&core.db, desktop_id, seed_key, crate::now_secs())?;
    }
    Ok(())
}

/// The launcher button, the system area, and the user's most-played titles pinned.
fn seed_taskbar(core: &Core) -> Result<()> {
    if db::taskbar::count(&core.db)? > 0 {
        return Ok(());
    }

    db::taskbar::put(
        &core.db,
        &TaskbarItem {
            id: "launcher".to_string(),
            kind: TaskbarItemKind::Launcher,
            target_id: None,
            sort_order: -1000,
        },
    )?;
    db::taskbar::put(
        &core.db,
        &TaskbarItem {
            id: "system-area".to_string(),
            kind: TaskbarItemKind::SystemArea,
            target_id: None,
            sort_order: 1000,
        },
    )?;

    // Three most-played, so the bar is not empty on a library that has been used.
    let most_played = crate::library::list(
        core,
        &EntryFilter {
            sort: SortKey::Playtime,
            limit: Some(3),
            ..Default::default()
        },
    )?;
    for item in most_played.iter().filter(|i| i.stats.playtime_secs > 0) {
        db::taskbar::pin(&core.db, &item.entry.id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::events::RecordingSink;
    use crate::Paths;

    fn test_core() -> (tempfile::TempDir, Arc<Core>, Arc<RecordingSink>) {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::rooted(tmp.path(), tmp.path().join("bundled-themes"));
        let sink = Arc::new(RecordingSink::default());
        let core = Core::new(paths, sink.clone()).unwrap();
        (tmp, core, sink)
    }

    fn add_game(core: &Core, id: &str, name: &str, playtime: u64) {
        let entry = Entry {
            id: id.into(),
            name: name.into(),
            entry_type: EntryType::Game,
            source: Source::Steam,
            source_id: Some(id.into()),
            launch: LaunchSpec::Uri {
                uri: format!("steam://rungameid/{id}"),
            },
            install_path: None,
            install_size: None,
            created_at: 1,
            updated_at: 1,
        };
        db::entries::upsert(&core.db, &entry).unwrap();
        if playtime > 0 {
            db::stats::add_playtime(&core.db, id, playtime).unwrap();
        }
    }

    #[test]
    fn seeding_reproduces_the_old_home_screen_as_folders() {
        let (_tmp, core, _sink) = test_core();
        add_game(&core, "g1", "Portal 2", 0);

        let desktop = seed_if_empty(&core)
            .unwrap()
            .expect("a first run must seed");
        let items = list_items(&core, &desktop.id).unwrap();
        let folders: Vec<_> = items
            .iter()
            .filter(|i| i.kind == DesktopItemKind::Folder)
            .collect();
        let widgets: Vec<_> = items
            .iter()
            .filter(|i| i.kind == DesktopItemKind::Widget)
            .collect();

        assert_eq!(folders.len(), 4, "games, apps, favourites, recently played");
        let mut cells: Vec<(i64, i64)> = folders.iter().map(|i| (i.x, i.y)).collect();
        cells.sort();
        assert_eq!(
            cells,
            vec![(0, 0), (0, 1), (1, 0), (1, 1)],
            "folders cluster two by two on the left"
        );

        // The first run has to fit the design's reference display without anything being pulled
        // into view: seven columns by three rows at 1080p. A column of four did not.
        assert!(
            items
                .iter()
                .all(|i| i.x + i.width <= 7 && i.y + i.height <= 3),
            "the seeded desktop must fit a 7 x 3 grid"
        );
        let occupied: std::collections::BTreeSet<(i64, i64)> = items
            .iter()
            .flat_map(|i| {
                (i.x..i.x + i.width).flat_map(move |x| (i.y..i.y + i.height).map(move |y| (x, y)))
            })
            .collect();
        let area: i64 = items.iter().map(|i| i.width * i.height).sum();
        assert_eq!(occupied.len() as i64, area, "no two seeded items overlap");

        // The widgets hold the right-hand side, which is what makes the first run a composition
        // rather than a column of icons and a lot of empty space.
        let ids: Vec<&str> = widgets
            .iter()
            .filter_map(|i| i.target_id.as_deref())
            .collect();
        assert_eq!(ids, vec![WIDGET_CLOCK, WIDGET_NOW_PLAYING]);
        assert!(widgets.iter().all(|i| i.x == 5 && i.width == 2));

        // Three shapes, so none of the theme's looks like a dead setting on a first run.
        let shapes: std::collections::BTreeSet<String> = list_folders(&core)
            .unwrap()
            .into_iter()
            .filter_map(|f| f.shape)
            .collect();
        assert_eq!(
            shapes.len(),
            3,
            "seeded folders should not all share one shape"
        );

        let labels: Vec<String> = list_folders(&core)
            .unwrap()
            .into_iter()
            .filter_map(|f| f.label)
            .collect();
        for expected in ["Games", "Apps", "Favourites", "Recently played"] {
            assert!(
                labels.contains(&expected.to_string()),
                "missing `{expected}`"
            );
        }

        // Idempotent: starting again must not double everything up.
        assert!(seed_if_empty(&core).unwrap().is_none());
        assert_eq!(list_items(&core, &desktop.id).unwrap().len(), items.len());
    }

    /// A desktop from before a default existed must gain it - "safe on every start" was already
    /// the contract; this is the part that used to be broken.
    #[test]
    fn a_desktop_that_predates_a_default_gets_it_backfilled() {
        let (_tmp, core, _sink) = test_core();

        // A desktop from an install that predates every default below - no folders, no widgets,
        // as an upgrade migration alone would leave one.
        let desktop = Desktop {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Desktop".to_string(),
            wallpaper: None,
            grid: GridSettings::default(),
            sort_order: 0,
        };
        db::desktops::upsert(&core.db, &desktop).unwrap();

        // Not a first run - the desktop already existed - so no new desktop is reported back.
        assert!(seed_if_empty(&core).unwrap().is_none());

        let items = list_items(&core, &desktop.id).unwrap();
        assert_eq!(
            items
                .iter()
                .filter(|i| i.kind == DesktopItemKind::Folder)
                .count(),
            4,
            "the pre-existing desktop must still gain the four smart folders"
        );
        let widget_ids: std::collections::BTreeSet<&str> = items
            .iter()
            .filter_map(|i| i.target_id.as_deref())
            .filter(|id| *id == WIDGET_CLOCK || *id == WIDGET_NOW_PLAYING)
            .collect();
        assert_eq!(widget_ids.len(), 2, "and both widgets");
    }

    /// Delete a seeded default, restart twice: it must not come back. Presence in
    /// `desktop_seeded_defaults` is what a restart checks, never whether the item survived.
    #[test]
    fn a_deleted_default_does_not_come_back() {
        let (_tmp, core, _sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();

        let clock = list_items(&core, &desktop.id)
            .unwrap()
            .into_iter()
            .find(|i| i.target_id.as_deref() == Some(WIDGET_CLOCK))
            .expect("the clock was seeded");
        db::desktops::remove_item(&core.db, &clock.id).unwrap();

        // Two more "starts".
        seed_if_empty(&core).unwrap();
        seed_if_empty(&core).unwrap();

        let items = list_items(&core, &desktop.id).unwrap();
        assert!(
            !items
                .iter()
                .any(|i| i.target_id.as_deref() == Some(WIDGET_CLOCK)),
            "a widget the user removed must not reappear on a later start"
        );
        // The other widget, untouched by the deletion, is still exactly one - not duplicated by
        // either of the two later calls.
        assert_eq!(
            items
                .iter()
                .filter(|i| i.target_id.as_deref() == Some(WIDGET_NOW_PLAYING))
                .count(),
            1
        );
    }

    /// A default added after a desktop was already fully seeded must still reach it, without
    /// touching the defaults that desktop already resolved.
    #[test]
    fn a_new_default_reaches_an_already_seeded_desktop_without_touching_the_others() {
        let (_tmp, core, _sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();
        let before = list_items(&core, &desktop.id).unwrap();

        // A throwaway sixth default, added the way a real one would be next year.
        const SEED_KEY_TEST_WIDGET: &str = "widget.test-only";
        assert!(!db::desktops::is_seeded(&core.db, &desktop.id, SEED_KEY_TEST_WIDGET).unwrap());
        db::desktops::add_item(
            &core.db,
            &NewDesktopItem {
                desktop_id: desktop.id.clone(),
                kind: Some(DesktopItemKind::Widget),
                target_id: Some("test-only".to_string()),
                x: 5,
                y: 2,
                ..Default::default()
            },
        )
        .unwrap();
        db::desktops::mark_seeded(
            &core.db,
            &desktop.id,
            SEED_KEY_TEST_WIDGET,
            crate::now_secs(),
        )
        .unwrap();

        // The desktop the new default reached is untouched otherwise: another "start" must not
        // add a second copy of it, nor touch any of the six defaults already resolved there.
        seed_if_empty(&core).unwrap();
        let after = list_items(&core, &desktop.id).unwrap();
        assert_eq!(after.len(), before.len() + 1, "exactly the one new item");
        assert_eq!(
            after
                .iter()
                .filter(|i| i.target_id.as_deref() == Some("test-only"))
                .count(),
            1
        );
    }

    #[test]
    fn a_seeded_smart_folder_actually_resolves_to_library_items() {
        let (_tmp, core, _sink) = test_core();
        add_game(&core, "g1", "Portal 2", 0);
        add_game(&core, "g2", "Celeste", 0);
        seed_if_empty(&core).unwrap();

        let games = list_folders(&core)
            .unwrap()
            .into_iter()
            .find(|f| f.path == SEEDED_GAMES)
            .expect("the games folder");

        let contents = folder_contents(&core, &games.id).unwrap();
        assert_eq!(contents.len(), 2);
        assert!(contents
            .iter()
            .all(|i| i.entry.entry_type == EntryType::Game));
    }

    #[test]
    fn the_taskbar_is_seeded_with_structure_and_the_most_played() {
        let (_tmp, core, _sink) = test_core();
        add_game(&core, "g1", "Played a lot", 10_000);
        add_game(&core, "g2", "Never played", 0);
        seed_if_empty(&core).unwrap();

        let bar = list_taskbar(&core).unwrap();
        assert!(bar.iter().any(|i| i.kind == TaskbarItemKind::Launcher));
        assert!(bar.iter().any(|i| i.kind == TaskbarItemKind::SystemArea));

        let pinned: Vec<Option<String>> = bar
            .iter()
            .filter(|i| i.kind == TaskbarItemKind::Pinned)
            .map(|i| i.target_id.clone())
            .collect();
        assert_eq!(
            pinned,
            vec![Some("g1".to_string())],
            "only titles with playtime are pinned"
        );
    }

    #[test]
    fn deleting_a_folder_takes_its_desktop_item_with_it() {
        let (_tmp, core, _sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();
        let folder = list_folders(&core).unwrap().into_iter().next().unwrap();

        let before = list_items(&core, &desktop.id).unwrap().len();
        delete_folder(&core, &folder.id).unwrap();
        let left = list_items(&core, &desktop.id).unwrap();
        assert_eq!(
            left.len(),
            before - 1,
            "the orphaned item is pruned, not left opening nothing"
        );
        assert!(left
            .iter()
            .all(|i| i.target_id.as_deref() != Some(folder.id.as_str())));
    }

    #[test]
    fn the_last_desktop_cannot_be_deleted() {
        let (_tmp, core, _sink) = test_core();
        let first = seed_if_empty(&core).unwrap().unwrap();
        assert!(matches!(
            delete_desktop(&core, &first.id),
            Err(CoreError::Invalid(_))
        ));

        let second = create_desktop(&core, "Work").unwrap();
        delete_desktop(&core, &second.id).unwrap();
        assert!(matches!(
            delete_desktop(&core, &first.id),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn moving_an_item_emits_and_persists() {
        let (_tmp, core, sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();
        sink.take();

        let item = list_items(&core, &desktop.id).unwrap().remove(0);
        let moved = update_item(
            &core,
            &item.id,
            DesktopItemPatch {
                x: Some(4),
                y: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((moved.x, moved.y), (4, 2));

        let events = sink.take();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, CoreEvent::DesktopUpdated(_))),
            "the UI needs to hear about it"
        );

        let reloaded = list_items(&core, &desktop.id).unwrap();
        let same = reloaded.iter().find(|i| i.id == item.id).unwrap();
        assert_eq!((same.x, same.y), (4, 2), "position survives a reload");
    }
}
