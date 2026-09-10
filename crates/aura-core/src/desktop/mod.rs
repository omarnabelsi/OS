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

fn emit_changed(core: &Core, reason: &str) {
    core.sink.emit(CoreEvent::DesktopUpdated(DesktopUpdated { reason: reason.to_string() }));
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
        return Err(CoreError::Invalid("the last desktop cannot be deleted".into()));
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
        return Err(CoreError::NotFound(format!("desktop `{}`", input.desktop_id)));
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
    let folder =
        db::folders::get(&core.db, id)?.ok_or_else(|| CoreError::NotFound(format!("folder `{id}`")))?;

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

/// Lay out a first desktop that mirrors what the old home screen showed.
///
/// A blank customisable desktop is worse than an opinionated one: the user upgrades, opens the
/// app and must see their library, arranged. Today's three home rows become smart folders, so
/// nothing is lost and everything becomes movable.
///
/// Does nothing when a desktop already exists, so it is safe to call on every start.
pub fn seed_if_empty(core: &Core) -> Result<Option<Desktop>> {
    if db::desktops::count(&core.db)? > 0 {
        return Ok(None);
    }

    let desktop = Desktop {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Desktop".to_string(),
        wallpaper: None,
        grid: GridSettings::default(),
        sort_order: 0,
    };
    db::desktops::upsert(&core.db, &desktop)?;

    // The old `home.rows`, promoted into openable folders. Column 0, top to bottom.
    let seeds: [(&str, &str, EntryFilter, &str); 4] = [
        (
            SEEDED_GAMES,
            "Games",
            EntryFilter { entry_type: Some(EntryType::Game), ..Default::default() },
            "games",
        ),
        (
            SEEDED_APPS,
            "Apps",
            EntryFilter { entry_type: Some(EntryType::App), ..Default::default() },
            "apps",
        ),
        (
            SEEDED_FAVOURITES,
            "Favourites",
            EntryFilter { favourites_only: true, ..Default::default() },
            "star",
        ),
        (
            SEEDED_RECENT,
            "Recently played",
            EntryFilter { sort: SortKey::LastPlayed, limit: Some(24), ..Default::default() },
            "play",
        ),
    ];

    for (row, (locator, label, filter, icon)) in seeds.into_iter().enumerate() {
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
                    shape: Some("rounded".to_string()),
                    ..Default::default()
                },
            )?,
        };

        db::desktops::add_item(
            &core.db,
            &NewDesktopItem {
                desktop_id: desktop.id.clone(),
                kind: Some(DesktopItemKind::Folder),
                target_id: Some(folder.id),
                x: 0,
                y: row as i64,
                ..Default::default()
            },
        )?;
    }

    seed_taskbar(core)?;
    emit_changed(core, "seeded");
    tracing::info!("seeded the default desktop with {} folders", seeds_len());
    Ok(Some(desktop))
}

fn seeds_len() -> usize {
    4
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
        &EntryFilter { sort: SortKey::Playtime, limit: Some(3), ..Default::default() },
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
            launch: LaunchSpec::Uri { uri: format!("steam://rungameid/{id}") },
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

        let desktop = seed_if_empty(&core).unwrap().expect("a first run must seed");
        let items = list_items(&core, &desktop.id).unwrap();
        assert_eq!(items.len(), 4, "games, apps, favourites, recently played");
        assert!(items.iter().all(|i| i.kind == DesktopItemKind::Folder));
        assert!(items.iter().all(|i| i.x == 0), "seeded down the first column");

        let labels: Vec<String> = list_folders(&core)
            .unwrap()
            .into_iter()
            .filter_map(|f| f.label)
            .collect();
        for expected in ["Games", "Apps", "Favourites", "Recently played"] {
            assert!(labels.contains(&expected.to_string()), "missing `{expected}`");
        }

        // Idempotent: starting again must not double everything up.
        assert!(seed_if_empty(&core).unwrap().is_none());
        assert_eq!(list_items(&core, &desktop.id).unwrap().len(), 4);
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
        assert!(contents.iter().all(|i| i.entry.entry_type == EntryType::Game));
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

        let pinned: Vec<Option<String>> =
            bar.iter().filter(|i| i.kind == TaskbarItemKind::Pinned).map(|i| i.target_id.clone()).collect();
        assert_eq!(pinned, vec![Some("g1".to_string())], "only titles with playtime are pinned");
    }

    #[test]
    fn deleting_a_folder_takes_its_desktop_item_with_it() {
        let (_tmp, core, _sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();
        let folder = list_folders(&core).unwrap().into_iter().next().unwrap();

        assert_eq!(list_items(&core, &desktop.id).unwrap().len(), 4);
        delete_folder(&core, &folder.id).unwrap();
        let left = list_items(&core, &desktop.id).unwrap();
        assert_eq!(left.len(), 3, "the orphaned item is pruned, not left opening nothing");
        assert!(left.iter().all(|i| i.target_id.as_deref() != Some(folder.id.as_str())));
    }

    #[test]
    fn the_last_desktop_cannot_be_deleted() {
        let (_tmp, core, _sink) = test_core();
        let first = seed_if_empty(&core).unwrap().unwrap();
        assert!(matches!(delete_desktop(&core, &first.id), Err(CoreError::Invalid(_))));

        let second = create_desktop(&core, "Work").unwrap();
        delete_desktop(&core, &second.id).unwrap();
        assert!(matches!(delete_desktop(&core, &first.id), Err(CoreError::Invalid(_))));
    }

    #[test]
    fn moving_an_item_emits_and_persists() {
        let (_tmp, core, sink) = test_core();
        let desktop = seed_if_empty(&core).unwrap().unwrap();
        sink.take();

        let item = list_items(&core, &desktop.id).unwrap().remove(0);
        let moved =
            update_item(&core, &item.id, DesktopItemPatch { x: Some(4), y: Some(2), ..Default::default() })
                .unwrap();
        assert_eq!((moved.x, moved.y), (4, 2));

        let events = sink.take();
        assert!(
            events.iter().any(|e| matches!(e, CoreEvent::DesktopUpdated(_))),
            "the UI needs to hear about it"
        );

        let reloaded = list_items(&core, &desktop.id).unwrap();
        let same = reloaded.iter().find(|i| i.id == item.id).unwrap();
        assert_eq!((same.x, same.y), (4, 2), "position survives a reload");
    }
}
