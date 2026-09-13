//! Every theme shipped in the repository's `themes/` folder must load through the real loader.
//!
//! `ThemeService::list` skips an invalid theme silently. That is right for a theme a user
//! downloaded - it must not take the shell down - but it means a broken *bundled* theme would
//! simply vanish from Settings and nobody would notice. This is where that gets noticed.

use std::path::{Path, PathBuf};

use aura_core::theme::ThemeService;

fn repo_themes() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("themes")
}

/// Folder names under `themes/` that contain a manifest.
fn bundled_ids() -> Vec<String> {
    let mut ids: Vec<String> = std::fs::read_dir(repo_themes())
        .expect("the repository has a themes/ folder")
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry
                .path()
                .join("manifest.json")
                .is_file()
                .then(|| entry.file_name().to_string_lossy().into_owned())
        })
        .collect();
    ids.sort();
    ids
}

fn service() -> ThemeService {
    // A user dir that does not exist, so only the bundled themes are under test.
    ThemeService::new(repo_themes(), repo_themes().join("__no_user_themes__"))
}

fn folder_shape_count(layout: &serde_json::Value) -> usize {
    layout
        .get("folderShapes")
        .and_then(|s| s.as_array())
        .map_or(0, Vec::len)
}

/// The manifest as written on disk, for the assertions that are about what a theme *claims*.
fn manifest_of(id: &str) -> serde_json::Value {
    let path = repo_themes().join(id).join("manifest.json");
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

#[test]
fn the_repository_ships_the_reference_theme_and_the_proofs() {
    let ids = bundled_ids();
    for expected in [
        "aura-default",
        "aura-paper",
        // The two that exist to prove a theme is only data: tokens, a layout and assets, no CSS.
        "aura-ember",
        "aura-daylight",
    ] {
        assert!(ids.iter().any(|id| id == expected), "{expected}: {ids:?}");
    }
}

#[test]
fn every_bundled_theme_is_listed_rather_than_skipped_as_invalid() {
    let listed: Vec<String> = service()
        .list()
        .expect("list themes")
        .into_iter()
        .map(|t| t.id)
        .collect();
    for id in bundled_ids() {
        assert!(
            listed.contains(&id),
            "`{id}` was skipped as invalid; listed: {listed:?}"
        );
    }
}

#[test]
fn every_bundled_theme_loads_with_all_its_folder_shapes_and_sounds() {
    let svc = service();
    for id in bundled_ids() {
        let bundle = svc
            .load(&id)
            .unwrap_or_else(|e| panic!("`{id}` failed to load: {e}"));

        // The loader drops a shape whose asset is missing or escapes the theme folder, with only
        // a log line. Compare against the file on disk so a dropped shape fails loudly here.
        let declared: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(repo_themes().join(&id).join("layout.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            folder_shape_count(&bundle.layout),
            folder_shape_count(&declared),
            "`{id}`: the loader dropped a folder shape"
        );
        assert!(
            folder_shape_count(&bundle.layout) > 0,
            "`{id}` offers the folder editor no shapes"
        );

        /*
         * Sounds and CSS are *claims*, not requirements.
         *
         * This used to demand all five sounds and a stylesheet from every bundled theme, which
         * was true of the two that existed when it was written and is not a rule: the validator
         * only warns about a missing sound slot, and `hasCss: false` is a supported manifest
         * value. `aura-ember` and `aura-daylight` ship neither on purpose - that is what makes
         * them the proof that a theme is data. So what is checked is honesty: whatever a theme
         * declares must actually load, and a theme that declares nothing gets nothing (the loader
         * never borrows another theme's file).
         */
        let manifest = manifest_of(&id);

        let declared_sounds = manifest
            .get("sounds")
            .and_then(|s| s.as_object())
            .cloned()
            .unwrap_or_default();
        for slot in ["move", "select", "back", "launch", "error"] {
            match declared_sounds.get(slot) {
                Some(_) => {
                    let path = bundle.sounds.get(slot).unwrap_or_else(|| {
                        panic!("`{id}` declares a `{slot}` sound but none loaded")
                    });
                    assert!(
                        Path::new(path).is_file(),
                        "`{id}` `{slot}` sound is missing: {path}"
                    );
                }
                None => assert!(
                    !bundle.sounds.contains_key(slot),
                    "`{id}` declares no `{slot}` sound, so it must have none"
                ),
            }
        }

        if manifest.get("hasCss").and_then(|v| v.as_bool()) == Some(false) {
            assert!(
                bundle.css.is_empty(),
                "`{id}` says it has no CSS, so none may load"
            );
        } else {
            assert!(
                !bundle.css.is_empty(),
                "`{id}` declares theme.css but none loaded"
            );
        }
    }
}
