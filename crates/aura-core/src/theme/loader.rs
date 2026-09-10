//! Read a theme folder into a `ThemeBundle`.
//!
//! Steps: read+parse `manifest.json` (Theme error on failure) -> `validate::manifest` ->
//! read `tokens.json`, `layout.json` (default `{}` if absent), `theme.css` (default "") ->
//! resolve sounds/shaders to absolute paths, read shader sources -> `ThemeBundle`.
//!
//! Sounds are limited to the five interface slots in `SOUND_SLOTS`; there is no music slot and a
//! theme cannot invent one.

use std::collections::HashMap;
use std::path::Path;

use super::manifest::{ThemeManifest, SOUND_SLOTS};
use super::{validate, APP_VERSION};
use crate::error::{CoreError, Result};
use crate::model::{ThemeBundle, ThemeInfo};

pub const MANIFEST_FILE: &str = "manifest.json";

/// Absolute where possible, so the UI can hand the path straight to `convertFileSrc`.
fn absolute(path: &Path) -> String {
    std::fs::canonicalize(path)
        .map(|p| {
            // Strip the Windows `\\?\` verbatim prefix; WebView2 will not load it.
            let s = p.display().to_string();
            s.strip_prefix(r"\\?\").map(String::from).unwrap_or(s)
        })
        .unwrap_or_else(|_| path.display().to_string())
}

pub fn read_manifest(dir: &Path) -> Result<ThemeManifest> {
    let path = dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        CoreError::Theme(format!("cannot read {}: {e}", path.display()))
    })?;
    serde_json::from_str(&raw)
        .map_err(|e| CoreError::Theme(format!("{} is not a valid theme manifest: {e}", path.display())))
}

pub fn info_from_manifest(dir: &Path, manifest: &ThemeManifest, builtin: bool) -> ThemeInfo {
    ThemeInfo {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        screenshots: manifest.screenshots.iter().map(|s| absolute(&dir.join(s))).collect(),
        path: absolute(dir),
        builtin,
        min_app_version: manifest.min_app_version.clone(),
    }
}

/// Read a JSON file, defaulting to `{}` when it is absent. A present-but-broken file is an error:
/// silently ignoring it would leave the author staring at an unstyled screen.
fn read_json_or_empty(path: &Path) -> Result<serde_json::Value> {
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| CoreError::Theme(format!("cannot read {}: {e}", path.display())))?;
    serde_json::from_str(&raw)
        .map_err(|e| CoreError::Theme(format!("{} is not valid JSON: {e}", path.display())))
}

pub fn load_from_dir(dir: &Path, builtin: bool) -> Result<ThemeBundle> {
    let manifest = read_manifest(dir)?;
    validate::manifest(dir, &manifest, APP_VERSION)?;

    let tokens = read_json_or_empty(&dir.join("tokens.json"))?;
    let mut layout = read_json_or_empty(&dir.join("layout.json"))?;
    // layout.json is handed to the UI verbatim and now references assets, so it is a
    // path-traversal surface for a shared theme. Offending entries are dropped, not fatal.
    for note in validate::sanitise_folder_shapes(dir, &mut layout) {
        tracing::warn!("theme `{}`: {note}", manifest.id);
    }

    let css_path = dir.join("theme.css");
    let css = if css_path.is_file() {
        std::fs::read_to_string(&css_path)
            .map_err(|e| CoreError::Theme(format!("cannot read {}: {e}", css_path.display())))?
    } else {
        String::new()
    };

    // Only the five known interface slots are resolved. A theme declaring anything else gets it
    // dropped here rather than handed to the UI: the app plays no music, and an unknown slot is
    // either a typo or an attempt to smuggle a soundtrack into the bundle. See THEME_FORMAT.md.
    let mut sounds = HashMap::new();
    for (slot, rel) in &manifest.sounds {
        if !SOUND_SLOTS.contains(&slot.as_str()) {
            tracing::warn!("theme `{}`: ignoring unknown sound slot `{slot}`", manifest.id);
            continue;
        }
        sounds.insert(slot.clone(), absolute(&dir.join(rel)));
    }

    // Shader sources are inlined: the UI compiles them, it never reads the file itself.
    let mut shaders = HashMap::new();
    for (id, rel) in &manifest.shaders {
        let path = dir.join(rel);
        match std::fs::read_to_string(&path) {
            Ok(src) => {
                shaders.insert(id.clone(), src);
            }
            Err(e) => tracing::warn!("theme `{}`: cannot read shader {id}: {e}", manifest.id),
        }
    }

    for note in validate::warnings(&manifest, &tokens) {
        tracing::debug!("theme `{}`: {note}", manifest.id);
    }

    Ok(ThemeBundle {
        info: info_from_manifest(dir, &manifest, builtin),
        tokens,
        layout,
        css,
        sounds,
        shaders,
        assets_dir: absolute(&dir.join("assets")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write a complete, valid theme folder and return its path.
    fn write_theme(root: &Path, id: &str) -> std::path::PathBuf {
        let dir = root.join(id);
        std::fs::create_dir_all(dir.join("sounds")).unwrap();
        std::fs::create_dir_all(dir.join("shaders")).unwrap();
        std::fs::create_dir_all(dir.join("assets")).unwrap();

        std::fs::write(dir.join("sounds").join("move.wav"), b"RIFF").unwrap();
        std::fs::write(dir.join("shaders").join("aurora.frag"), "void main(){}").unwrap();
        std::fs::write(dir.join("theme.css"), ".aura-root{}").unwrap();
        // r##"..."## because the JSON contains `"#` (hex colours), which would close an r#".
        std::fs::write(
            dir.join("tokens.json"),
            r##"{"color":{"accent":"#6ee7ff","background":"#07080c"}}"##,
        )
        .unwrap();
        std::fs::write(dir.join("layout.json"), r#"{"regions":["navBar"]}"#).unwrap();
        std::fs::write(
            dir.join(MANIFEST_FILE),
            format!(
                r#"{{
                  "id": "{id}",
                  "name": "Test",
                  "author": "Someone",
                  "version": "1.0.0",
                  "engine": "aura-theme/1",
                  "sounds": {{ "move": "sounds/move.wav" }},
                  "shaders": {{ "aurora": "shaders/aurora.frag" }},
                  "hasCss": true
                }}"#
            ),
        )
        .unwrap();
        dir
    }

    #[test]
    fn loads_a_complete_theme() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_theme(tmp.path(), "test-theme");

        let bundle = load_from_dir(&dir, true).unwrap();
        assert_eq!(bundle.info.id, "test-theme");
        assert_eq!(bundle.info.name, "Test");
        assert!(bundle.info.builtin);
        assert_eq!(bundle.tokens["color"]["accent"], "#6ee7ff");
        assert_eq!(bundle.layout["regions"][0], "navBar");
        assert_eq!(bundle.css, ".aura-root{}");
        assert_eq!(bundle.shaders.get("aurora").map(String::as_str), Some("void main(){}"));

        // Sounds are absolute paths; shaders are inlined source.
        let move_sound = bundle.sounds.get("move").expect("move sound");
        assert!(Path::new(move_sound).is_file(), "got {move_sound}");
        assert!(!bundle.assets_dir.is_empty());
        assert!(!bundle.info.path.contains(r"\\?\"), "verbatim prefix must be stripped");
    }

    /// The app plays no music, so a theme must not be able to get an audio file of its own
    /// choosing into the bundle by inventing a sound slot for it.
    #[test]
    fn an_unknown_sound_slot_is_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_theme(tmp.path(), "test-theme");
        std::fs::write(dir.join("sounds").join("soundtrack.mp3"), b"ID3").unwrap();
        std::fs::write(
            dir.join(MANIFEST_FILE),
            r#"{
              "id": "test-theme",
              "name": "Test",
              "author": "Someone",
              "version": "1.0.0",
              "engine": "aura-theme/1",
              "sounds": {
                "move": "sounds/move.wav",
                "music": "sounds/soundtrack.mp3",
                "ambience": "sounds/soundtrack.mp3"
              }
            }"#,
        )
        .unwrap();

        let bundle = load_from_dir(&dir, true).unwrap();
        assert!(bundle.sounds.contains_key("move"), "a real slot still loads");
        assert_eq!(bundle.sounds.len(), 1, "only the known slot survives");
        for invented in ["music", "ambience"] {
            assert!(!bundle.sounds.contains_key(invented), "`{invented}` must not reach the UI");
        }
    }

    /// R5: a shared theme must not be able to reach outside its own folder through layout.json.
    #[test]
    fn folder_shapes_that_escape_the_theme_folder_are_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_theme(tmp.path(), "test-theme");
        std::fs::create_dir_all(dir.join("assets").join("folders")).unwrap();
        std::fs::write(dir.join("assets").join("folders").join("rounded.svg"), "<svg/>").unwrap();
        std::fs::write(
            dir.join("layout.json"),
            r#"{
              "folderShapes": [
                { "id": "rounded",  "asset": "assets/folders/rounded.svg" },
                { "id": "escape",   "asset": "../../../windows/system32/config/sam" },
                { "id": "absolute", "asset": "C:/Windows/win.ini" },
                { "id": "missing",  "asset": "assets/folders/nope.svg" },
                { "id": "Bad Id",   "asset": "assets/folders/rounded.svg" },
                { "asset": "assets/folders/rounded.svg" }
              ]
            }"#,
        )
        .unwrap();

        let bundle = load_from_dir(&dir, true).unwrap();
        let shapes = bundle.layout["folderShapes"].as_array().unwrap();
        let ids: Vec<&str> = shapes.iter().filter_map(|s| s["id"].as_str()).collect();
        assert_eq!(ids, vec!["rounded"], "only the safe, existing, well-named shape survives");
    }

    #[test]
    fn missing_optional_files_default_cleanly() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("bare-theme");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(MANIFEST_FILE),
            r#"{"id":"bare-theme","name":"Bare","author":"x","version":"1.0.0","hasCss":false}"#,
        )
        .unwrap();

        let bundle = load_from_dir(&dir, false).unwrap();
        assert_eq!(bundle.tokens, serde_json::json!({}));
        assert_eq!(bundle.layout, serde_json::json!({}));
        assert_eq!(bundle.css, "");
        assert!(bundle.sounds.is_empty());
        assert!(bundle.shaders.is_empty());
        assert!(!bundle.info.builtin);
    }

    #[test]
    fn a_broken_manifest_is_a_theme_error() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("broken");
        std::fs::create_dir_all(&dir).unwrap();

        assert!(matches!(read_manifest(&dir), Err(CoreError::Theme(_))), "no manifest at all");

        std::fs::write(dir.join(MANIFEST_FILE), "{ not json").unwrap();
        assert!(matches!(read_manifest(&dir), Err(CoreError::Theme(_))));
    }

    #[test]
    fn broken_json_files_fail_loudly() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_theme(tmp.path(), "test-theme");
        std::fs::write(dir.join("tokens.json"), "{ oops").unwrap();

        let err = load_from_dir(&dir, true).unwrap_err();
        assert!(matches!(err, CoreError::Theme(_)));
        assert!(err.to_string().contains("tokens.json"), "got {err}");
    }

    #[test]
    fn validation_failures_stop_the_load() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_theme(tmp.path(), "test-theme");
        // Declare a sound that is not there.
        std::fs::remove_file(dir.join("sounds").join("move.wav")).unwrap();
        assert!(matches!(load_from_dir(&dir, true), Err(CoreError::Theme(_))));
    }
}
