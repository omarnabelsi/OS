//! Artwork pipeline: SteamGridDB (when an API key is set) -> Steam CDN (for Steam entries) ->
//! local cache -> `artwork` table -> `library://artwork` events.
//!
//! Rules:
//!   - Never overwrite a `user_override` row unless `force`.
//!   - Fetch grid, hero, logo, icon independently; a missing logo is not an error.
//!   - Cache path via `cache::cache_path`; skip the download if the file exists and !force.
//!   - Emit one `ArtworkUpdated` per asset saved, and one `Toast{Warning}` if everything failed.
//!   - Rate-limit SteamGridDB to roughly 4 requests/sec.

pub mod cache;
pub mod steam_cdn;
pub mod steamgriddb;

use std::sync::Arc;
use std::time::Duration;

use crate::db;
use crate::error::{CoreError, Result};
use crate::events::CoreEvent;
use crate::model::*;
use crate::Core;

/// Gap between SteamGridDB calls (~4 requests/sec).
const SGDB_THROTTLE: Duration = Duration::from_millis(250);
/// How many SteamGridDB candidates to try per asset before falling back to the CDN.
const SGDB_CANDIDATES: usize = 3;

/// Environment fallback for the API key, so CI and power users need not store it in the DB.
pub const API_KEY_ENV: &str = "AURA_STEAMGRIDDB_API_KEY";

/// Background fetch for one entry (spawns a thread).
pub fn start_fetch(core: Arc<Core>, entry_id: String, force: bool) {
    start_fetch_many(core, vec![entry_id], force)
}

/// Background fetch for many entries on a single thread, so a 200-game library does not
/// spawn 200 threads (or 200 simultaneous HTTP requests).
pub fn start_fetch_many(core: Arc<Core>, entry_ids: Vec<String>, force: bool) {
    if entry_ids.is_empty() {
        return;
    }
    let spawned = std::thread::Builder::new().name("aura-artwork".into()).spawn(move || {
        for id in entry_ids {
            let entry = match db::entries::get(&core.db, &id) {
                Ok(Some(e)) => e,
                Ok(None) => continue,
                Err(e) => {
                    tracing::warn!("artwork: cannot load entry {id}: {e}");
                    continue;
                }
            };
            if let Err(e) = fetch_for_entry(&core, &entry, force) {
                tracing::warn!("artwork: fetch failed for {}: {e}", entry.name);
            }
        }
    });
    if let Err(e) = spawned {
        tracing::error!("cannot spawn the artwork thread: {e}");
    }
}

fn api_key(core: &Core) -> Option<String> {
    core.settings()
        .steamgriddb_api_key
        .filter(|k| !k.trim().is_empty())
        .or_else(|| std::env::var(API_KEY_ENV).ok())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

/// SteamGridDB game id for an entry: by appid for Steam titles, by name for everything else.
fn resolve_sgdb_game(client: &steamgriddb::SgdbClient<'_>, entry: &Entry) -> Option<u64> {
    let by_appid = match (entry.source, entry.source_id.as_deref()) {
        (Source::Steam, Some(appid)) => match client.game_id_by_steam_appid(appid) {
            Ok(id) => id,
            Err(e) => {
                tracing::debug!("steamgriddb lookup for appid {appid} failed: {e}");
                None
            }
        },
        _ => None,
    };
    std::thread::sleep(SGDB_THROTTLE);
    if by_appid.is_some() {
        return by_appid;
    }
    match client.search_game(&entry.name) {
        Ok(id) => {
            std::thread::sleep(SGDB_THROTTLE);
            id
        }
        Err(e) => {
            tracing::debug!("steamgriddb search for `{}` failed: {e}", entry.name);
            None
        }
    }
}

/// Candidate URLs for one asset, best source first, each tagged with where it came from.
fn candidate_urls(
    client: Option<&steamgriddb::SgdbClient<'_>>,
    sgdb_game_id: Option<u64>,
    entry: &Entry,
    kind: ArtworkKind,
) -> Vec<(String, &'static str)> {
    let mut out: Vec<(String, &'static str)> = Vec::new();

    if let (Some(client), Some(game_id)) = (client, sgdb_game_id) {
        match client.images(game_id, kind) {
            Ok(images) => out.extend(
                images.into_iter().take(SGDB_CANDIDATES).map(|i| (i.url, "steamgriddb")),
            ),
            Err(e) => tracing::debug!("steamgriddb images({game_id}, {kind:?}) failed: {e}"),
        }
        std::thread::sleep(SGDB_THROTTLE);
    }

    if entry.source == Source::Steam {
        if let Some(appid) = &entry.source_id {
            out.extend(steam_cdn::candidates(appid, kind).into_iter().map(|u| (u, "steam_cdn")));
        }
    }

    out
}

/// Blocking fetch. Returns the resulting artwork row (possibly unchanged).
pub fn fetch_for_entry(core: &Core, entry: &Entry, force: bool) -> Result<Artwork> {
    let mut current = db::artwork::get(&core.db, &entry.id)?;
    if current.user_override && !force {
        tracing::debug!("artwork: `{}` is user-overridden, skipping", entry.name);
        return Ok(current);
    }

    let key = api_key(core);
    let client = key.as_deref().map(|k| steamgriddb::SgdbClient::new(&core.http, k));
    let sgdb_game_id = client.as_ref().and_then(|c| resolve_sgdb_game(c, entry));

    let mut saved = 0usize;
    let mut attempted = 0usize;

    for kind in ArtworkKind::ALL {
        if current.get(kind).is_some() && !force {
            continue;
        }

        for (url, source) in candidate_urls(client.as_ref(), sgdb_game_id, entry, kind) {
            attempted += 1;
            let dest = cache::cache_path(&core.paths.artwork_dir, &entry.id, kind, &url);

            // Already downloaded on an earlier run: adopt it without touching the network.
            let hit = if dest.is_file() && !force {
                true
            } else {
                match cache::download(&core.http, &url, &dest) {
                    Ok(true) => true,
                    Ok(false) => false,
                    Err(e) => {
                        tracing::debug!("artwork: {url} failed: {e}");
                        false
                    }
                }
            };
            if !hit {
                continue;
            }

            let path = dest.display().to_string();
            current = db::artwork::set_kind(&core.db, &entry.id, kind, Some(&path), source, false)?;
            saved += 1;
            core.sink.emit(CoreEvent::ArtworkUpdated(ArtworkUpdated {
                entry_id: entry.id.clone(),
                kind,
                path,
                source: source.to_string(),
            }));
            break;
        }
    }

    // Only complain when we tried and got nothing at all - a missing logo is not an error.
    if saved == 0 && attempted > 0 && !current.is_complete() {
        core.sink.emit(CoreEvent::Toast(Toast {
            level: ToastLevel::Warning,
            message: format!("No artwork found for {}", entry.name),
        }));
    }

    Ok(current)
}

/// User replaces one asset. Copies the file into the cache dir and marks `user_override`.
pub fn set_override(core: &Core, entry_id: &str, kind: ArtworkKind, path: &str) -> Result<Artwork> {
    if db::entries::get(&core.db, entry_id)?.is_none() {
        return Err(CoreError::NotFound(format!("entry `{entry_id}`")));
    }

    let source_file = std::path::Path::new(path.trim());
    if !source_file.is_file() {
        return Err(CoreError::NotFound(format!("`{path}` is not a file")));
    }
    let bytes = std::fs::metadata(source_file)?.len();
    if bytes > cache::MAX_BYTES {
        return Err(CoreError::Invalid(format!(
            "`{path}` is {bytes} bytes, over the {} byte limit",
            cache::MAX_BYTES
        )));
    }

    let dest = cache::override_path(&core.paths.artwork_dir, entry_id, kind, source_file);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source_file, &dest)?;

    let stored = dest.display().to_string();
    let artwork = db::artwork::set_kind(&core.db, entry_id, kind, Some(&stored), "user", true)?;
    core.sink.emit(CoreEvent::ArtworkUpdated(ArtworkUpdated {
        entry_id: entry_id.to_string(),
        kind,
        path: stored,
        source: "user".to_string(),
    }));
    Ok(artwork)
}

#[cfg(test)]
mod tests {
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

    fn add_entry(core: &Core, id: &str) -> Entry {
        let entry = Entry {
            id: id.into(),
            name: "Portal 2".into(),
            entry_type: EntryType::Game,
            source: Source::Steam,
            source_id: Some("620".into()),
            launch: LaunchSpec::Uri { uri: "steam://rungameid/620".into() },
            install_path: None,
            install_size: None,
            created_at: 1,
            updated_at: 1,
        };
        db::entries::upsert(&core.db, &entry).unwrap();
        entry
    }

    #[test]
    fn set_override_copies_marks_and_emits() {
        let (tmp, core, sink) = test_core();
        add_entry(&core, "e1");

        let picked = tmp.path().join("my art.png");
        std::fs::write(&picked, b"\x89PNG fake").unwrap();

        let art = set_override(&core, "e1", ArtworkKind::Grid, &picked.display().to_string())
            .unwrap();

        assert!(art.user_override);
        assert_eq!(art.source.as_deref(), Some("user"));
        let stored = art.grid.expect("grid path");
        assert!(std::path::Path::new(&stored).is_file(), "the file must be copied into the cache");
        assert!(stored.starts_with(&core.paths.artwork_dir.display().to_string()));
        assert_eq!(std::fs::read(&stored).unwrap(), b"\x89PNG fake");

        let events = sink.take();
        assert!(matches!(
            events.as_slice(),
            [CoreEvent::ArtworkUpdated(u)] if u.entry_id == "e1" && u.kind == ArtworkKind::Grid && u.source == "user"
        ));
    }

    #[test]
    fn set_override_validates_its_inputs() {
        let (tmp, core, _sink) = test_core();
        add_entry(&core, "e1");

        assert!(matches!(
            set_override(&core, "missing", ArtworkKind::Grid, "x"),
            Err(CoreError::NotFound(_))
        ));
        assert!(matches!(
            set_override(&core, "e1", ArtworkKind::Grid, &tmp.path().join("nope.png").display().to_string()),
            Err(CoreError::NotFound(_))
        ));
        // A directory is not a file.
        assert!(matches!(
            set_override(&core, "e1", ArtworkKind::Grid, &tmp.path().display().to_string()),
            Err(CoreError::NotFound(_))
        ));
    }

    #[test]
    fn a_user_override_is_not_refetched() {
        let (tmp, core, sink) = test_core();
        let entry = add_entry(&core, "e1");
        let picked = tmp.path().join("art.png");
        std::fs::write(&picked, b"png").unwrap();
        set_override(&core, "e1", ArtworkKind::Grid, &picked.display().to_string()).unwrap();
        sink.take();

        // No network is touched: the override short-circuits before any HTTP call.
        let art = fetch_for_entry(&core, &entry, false).unwrap();
        assert!(art.user_override);
        assert!(sink.take().is_empty(), "no events for a skipped fetch");
    }

    #[test]
    fn api_key_prefers_settings_then_environment() {
        let (_tmp, core, _sink) = test_core();
        assert_eq!(api_key(&core), std::env::var(API_KEY_ENV).ok(), "no setting -> env or none");

        core.update_settings(serde_json::json!({ "steamgriddbApiKey": "abc123" })).unwrap();
        assert_eq!(api_key(&core).as_deref(), Some("abc123"));

        core.update_settings(serde_json::json!({ "steamgriddbApiKey": "   " })).unwrap();
        assert_eq!(api_key(&core), std::env::var(API_KEY_ENV).ok(), "blank is treated as unset");
    }

    #[test]
    fn candidates_fall_back_to_the_steam_cdn_without_a_key() {
        let (_tmp, core, _sink) = test_core();
        let entry = add_entry(&core, "e1");
        let urls = candidate_urls(None, None, &entry, ArtworkKind::Grid);
        assert!(!urls.is_empty());
        assert!(urls.iter().all(|(_, src)| *src == "steam_cdn"));
        assert!(urls[0].0.contains("/620/library_600x900_2x.jpg"));
    }

    #[test]
    fn manual_entries_have_no_cdn_candidates() {
        let (_tmp, core, _sink) = test_core();
        let mut entry = add_entry(&core, "e1");
        entry.source = Source::Manual;
        entry.source_id = None;
        assert!(candidate_urls(None, None, &entry, ArtworkKind::Grid).is_empty());
    }
}
