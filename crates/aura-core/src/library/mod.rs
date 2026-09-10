//! Library service: the joined view of entries + artwork + stats, the manual-add path, and
//! background store scans.
//!
//! Scan flow (`run_scan`):
//!   1. emit ScanProgress{Queued}
//!   2. for each scanner: emit Discovering, `scanner.scan()`, emit Parsing/Saving
//!   3. upsert each DiscoveredEntry (match on (source, source_id); keep the existing id)
//!   4. entries no longer present on disk are NOT deleted in V1 - just logged
//!   5. emit LibraryUpdated{reason:"scan"} then ScanProgress{Done, done:true}
//!   6. kick one background artwork pass for every entry still missing art
//!
//! Scans run on a std thread; `Core` is `Arc`. Errors are emitted as ScanProgress{Error}.

pub mod scanners;
pub mod vdf;

use std::sync::Arc;

use crate::db;
use crate::error::{CoreError, Result};
use crate::events::CoreEvent;
use crate::model::*;
use crate::{artwork, Core};

/// Join an entry with its artwork and stats.
pub fn hydrate(core: &Core, entry: Entry) -> Result<LibraryItem> {
    let artwork = db::artwork::get(&core.db, &entry.id)?;
    let stats = db::stats::get(&core.db, &entry.id)?;
    Ok(LibraryItem {
        entry,
        artwork,
        stats,
    })
}

pub fn list(core: &Core, filter: &EntryFilter) -> Result<Vec<LibraryItem>> {
    db::entries::list(&core.db, filter)?
        .into_iter()
        .map(|e| hydrate(core, e))
        .collect()
}

pub fn get(core: &Core, id: &str) -> Result<Option<LibraryItem>> {
    match db::entries::get(&core.db, id)? {
        Some(e) => Ok(Some(hydrate(core, e)?)),
        None => Ok(None),
    }
}

fn emit_updated(core: &Core, entry_ids: Vec<String>, reason: &str) {
    core.sink.emit(CoreEvent::LibraryUpdated(LibraryUpdated {
        entry_ids,
        reason: reason.to_string(),
    }));
}

fn entry_from_discovered(d: &DiscoveredEntry, id: String, created_at: i64, now: i64) -> Entry {
    Entry {
        id,
        name: d.name.clone(),
        entry_type: d.entry_type,
        source: d.source,
        source_id: d.source_id.clone(),
        launch: d.launch.clone(),
        install_path: d.install_path.clone(),
        install_size: d.install_size,
        created_at,
        updated_at: now,
    }
}

/// Validate the executable, build an `Entry` (source = Manual), persist, emit
/// `LibraryUpdated{reason:"manual_add"}` and return it.
///
/// No background work happens here: `Core::add_manual_entry` starts the artwork pass (which for a
/// manual entry means reading the executable's own icon) once this has returned.
pub fn add_manual(core: &Core, input: AddManualEntryInput) -> Result<LibraryItem> {
    let discovered = scanners::manual::discover(&input)?;
    let now = crate::now_secs();
    let entry = entry_from_discovered(&discovered, uuid::Uuid::new_v4().to_string(), now, now);
    db::entries::upsert(&core.db, &entry)?;
    emit_updated(core, vec![entry.id.clone()], "manual_add");
    hydrate(core, entry)
}

pub fn update(core: &Core, id: &str, patch: UpdateEntryPatch) -> Result<LibraryItem> {
    let now = crate::now_secs();
    let entry = db::entries::update_patch(&core.db, id, &patch, now)?
        .ok_or_else(|| CoreError::NotFound(format!("entry `{id}`")))?;
    if patch.favourite.is_some() || patch.hidden.is_some() {
        db::stats::set_flags(&core.db, id, patch.favourite, patch.hidden)?;
    }
    emit_updated(core, vec![id.to_string()], "update");
    hydrate(core, entry)
}

pub fn remove(core: &Core, id: &str) -> Result<()> {
    if !db::entries::delete(&core.db, id)? {
        return Err(CoreError::NotFound(format!("entry `{id}`")));
    }
    emit_updated(core, vec![id.to_string()], "remove");
    Ok(())
}

/// Persist scanner output. Returns ids of new or changed entries. Public for tests.
///
/// Writes are one statement each rather than one big transaction: the mutex around the
/// connection is not reentrant, and a few hundred WAL-mode upserts are well under the
/// "library appears in 3 seconds" budget.
pub fn persist_discovered(core: &Core, discovered: &[DiscoveredEntry]) -> Result<Vec<String>> {
    let now = crate::now_secs();
    let mut touched = Vec::new();

    for d in discovered {
        let existing = match &d.source_id {
            Some(sid) => db::entries::find_by_source(&core.db, d.source, sid)?,
            None => None,
        };

        let (id, created_at, changed) = match &existing {
            Some(e) => {
                let changed = e.name != d.name
                    || e.entry_type != d.entry_type
                    || e.launch != d.launch
                    || e.install_path != d.install_path
                    || e.install_size != d.install_size;
                (e.id.clone(), e.created_at, changed)
            }
            None => (uuid::Uuid::new_v4().to_string(), now, true),
        };

        if !changed {
            continue;
        }
        let entry = entry_from_discovered(d, id.clone(), created_at, now);
        db::entries::upsert(&core.db, &entry)?;
        touched.push(id);
    }

    Ok(touched)
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    core: &Core,
    job_id: &str,
    stage: ScanStage,
    source: Option<Source>,
    found: u32,
    message: Option<String>,
    done: bool,
) {
    core.sink.emit(CoreEvent::ScanProgress(ScanProgress {
        job_id: job_id.to_string(),
        source,
        stage,
        found,
        message,
        done,
    }));
}

/// Spawn the scan thread and return its job id.
pub fn start_scan(core: Arc<Core>, sources: Vec<Source>) -> String {
    let job_id = uuid::Uuid::new_v4().to_string();
    let thread_job_id = job_id.clone();
    std::thread::Builder::new()
        .name("aura-scan".into())
        .spawn(move || run_scan(core, thread_job_id, sources))
        .expect("spawn scan thread");
    job_id
}

/// The scan itself. Blocking; runs on the scan thread. Public so tests can drive it directly.
pub fn run_scan(core: Arc<Core>, job_id: String, sources: Vec<Source>) {
    emit_progress(&core, &job_id, ScanStage::Queued, None, 0, None, false);

    let found_scanners = scanners::scanners_for(&sources);
    if found_scanners.is_empty() {
        emit_progress(
            &core,
            &job_id,
            ScanStage::Done,
            None,
            0,
            Some("no supported stores are installed".into()),
            true,
        );
        return;
    }

    let mut all_ids: Vec<String> = Vec::new();
    let mut total: u32 = 0;

    for scanner in found_scanners {
        let source = scanner.source();
        emit_progress(
            &core,
            &job_id,
            ScanStage::Discovering,
            Some(source),
            total,
            None,
            false,
        );

        let discovered = match scanner.scan() {
            Ok(d) => d,
            Err(e) => {
                let msg = format!("{} scan failed: {e}", source.as_str());
                tracing::warn!("{msg}");
                emit_progress(
                    &core,
                    &job_id,
                    ScanStage::Error,
                    Some(source),
                    total,
                    Some(msg.clone()),
                    false,
                );
                core.sink.emit(CoreEvent::Toast(Toast {
                    level: ToastLevel::Warning,
                    message: msg,
                }));
                continue;
            }
        };

        total += discovered.len() as u32;
        emit_progress(
            &core,
            &job_id,
            ScanStage::Parsing,
            Some(source),
            total,
            None,
            false,
        );
        emit_progress(
            &core,
            &job_id,
            ScanStage::Saving,
            Some(source),
            total,
            None,
            false,
        );

        match persist_discovered(&core, &discovered) {
            Ok(ids) => {
                tracing::info!(
                    "{}: {} found, {} new or changed",
                    source.as_str(),
                    discovered.len(),
                    ids.len()
                );
                all_ids.extend(ids);
            }
            Err(e) => {
                let msg = format!("could not save {} entries: {e}", source.as_str());
                tracing::error!("{msg}");
                emit_progress(
                    &core,
                    &job_id,
                    ScanStage::Error,
                    Some(source),
                    total,
                    Some(msg.clone()),
                    false,
                );
                core.sink.emit(CoreEvent::Toast(Toast {
                    level: ToastLevel::Error,
                    message: msg,
                }));
            }
        }
    }

    if !all_ids.is_empty() {
        emit_updated(&core, all_ids, "scan");
    }
    emit_progress(&core, &job_id, ScanStage::Done, None, total, None, true);

    // One background pass for everything still missing art, rather than a thread per entry.
    match db::artwork::incomplete_entry_ids(&core.db) {
        Ok(ids) if !ids.is_empty() => artwork::start_fetch_many(core.clone(), ids, false),
        Ok(_) => {}
        Err(e) => tracing::warn!("cannot list entries missing artwork: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::RecordingSink;
    use crate::Paths;

    pub(crate) fn test_core() -> (tempfile::TempDir, Arc<Core>, Arc<RecordingSink>) {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::rooted(tmp.path(), tmp.path().join("bundled-themes"));
        let sink = Arc::new(RecordingSink::default());
        let core = Core::new(paths, sink.clone()).unwrap();
        (tmp, core, sink)
    }

    fn discovered(name: &str, appid: &str) -> DiscoveredEntry {
        DiscoveredEntry {
            name: name.into(),
            entry_type: EntryType::Game,
            source: Source::Steam,
            source_id: Some(appid.into()),
            launch: LaunchSpec::Uri {
                uri: format!("steam://rungameid/{appid}"),
            },
            install_path: Some(format!("C:/games/{name}")),
            install_size: Some(100),
        }
    }

    #[test]
    fn manual_add_hydrates_and_emits() {
        let (tmp, core, sink) = test_core();
        let exe = tmp.path().join("my_game-x64.exe");
        std::fs::write(&exe, b"MZ").unwrap();

        let item = add_manual(
            &core,
            AddManualEntryInput {
                name: None,
                path: exe.display().to_string(),
                args: vec![],
                entry_type: None,
            },
        )
        .unwrap();

        assert_eq!(item.entry.name, "My Game");
        assert_eq!(item.entry.source, Source::Manual);
        assert_eq!(item.artwork, Artwork::default());
        assert_eq!(item.stats, Stats::default());

        let events = sink.take();
        assert!(matches!(
            events.as_slice(),
            [CoreEvent::LibraryUpdated(u)] if u.reason == "manual_add" && u.entry_ids.len() == 1
        ));

        assert_eq!(
            get(&core, &item.entry.id).unwrap().unwrap().entry.name,
            "My Game"
        );
        assert!(get(&core, "missing").unwrap().is_none());
    }

    #[test]
    fn update_writes_name_to_entries_and_flags_to_stats() {
        let (tmp, core, sink) = test_core();
        let exe = tmp.path().join("game.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let item = add_manual(
            &core,
            AddManualEntryInput {
                name: Some("Original".into()),
                path: exe.display().to_string(),
                args: vec![],
                entry_type: None,
            },
        )
        .unwrap();
        sink.take();

        let updated = update(
            &core,
            &item.entry.id,
            UpdateEntryPatch {
                name: Some("Renamed".into()),
                favourite: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.entry.name, "Renamed");
        assert!(updated.stats.favourite);
        assert!(!updated.stats.hidden);

        let events = sink.take();
        assert!(
            matches!(events.as_slice(), [CoreEvent::LibraryUpdated(u)] if u.reason == "update")
        );

        assert!(matches!(
            update(&core, "missing", UpdateEntryPatch::default()),
            Err(CoreError::NotFound(_))
        ));
    }

    #[test]
    fn remove_deletes_and_reports_missing() {
        let (tmp, core, _sink) = test_core();
        let exe = tmp.path().join("game.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let item = add_manual(
            &core,
            AddManualEntryInput {
                name: None,
                path: exe.display().to_string(),
                args: vec![],
                entry_type: None,
            },
        )
        .unwrap();

        remove(&core, &item.entry.id).unwrap();
        assert!(get(&core, &item.entry.id).unwrap().is_none());
        assert!(matches!(
            remove(&core, &item.entry.id),
            Err(CoreError::NotFound(_))
        ));
    }

    #[test]
    fn persist_is_idempotent_and_keeps_ids() {
        let (_tmp, core, _sink) = test_core();
        let batch = vec![
            discovered("Portal 2", "620"),
            discovered("Celeste", "504230"),
        ];

        let first = persist_discovered(&core, &batch).unwrap();
        assert_eq!(first.len(), 2, "both are new");

        let second = persist_discovered(&core, &batch).unwrap();
        assert!(second.is_empty(), "an unchanged rescan must touch nothing");

        // A renamed game keeps its id so stats and artwork survive.
        let mut renamed = batch.clone();
        renamed[0].name = "Portal 2 - Deluxe".into();
        let third = persist_discovered(&core, &renamed).unwrap();
        assert_eq!(third, vec![first[0].clone()]);

        let all = list(&core, &EntryFilter::default()).unwrap();
        assert_eq!(all.len(), 2, "renaming must not duplicate the entry");
    }

    #[test]
    fn list_hydrates_with_artwork_and_stats() {
        let (_tmp, core, _sink) = test_core();
        persist_discovered(&core, &[discovered("Portal 2", "620")]).unwrap();
        let id = list(&core, &EntryFilter::default()).unwrap()[0]
            .entry
            .id
            .clone();

        db::stats::set_flags(&core.db, &id, Some(true), None).unwrap();
        db::artwork::set_kind(
            &core.db,
            &id,
            ArtworkKind::Grid,
            Some("C:/g.jpg"),
            "steam_cdn",
            false,
        )
        .unwrap();

        let item = &list(&core, &EntryFilter::default()).unwrap()[0];
        assert!(item.stats.favourite);
        assert_eq!(item.artwork.grid.as_deref(), Some("C:/g.jpg"));
    }

    #[test]
    fn scan_with_no_installed_store_completes_cleanly() {
        let (_tmp, core, sink) = test_core();
        // Source::Manual has no scanner, so `scanners_for` returns an empty list.
        run_scan(core.clone(), "job-1".into(), vec![Source::Manual]);

        let events = sink.take();
        let progress: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                CoreEvent::ScanProgress(p) => Some(p),
                _ => None,
            })
            .collect();
        assert_eq!(progress.first().unwrap().stage, ScanStage::Queued);
        let last = progress.last().unwrap();
        assert_eq!(last.stage, ScanStage::Done);
        assert!(last.done);
        assert_eq!(last.job_id, "job-1");
    }
}
