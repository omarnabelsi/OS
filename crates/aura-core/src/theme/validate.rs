//! Theme validation. Hard errors stop a theme from loading; warnings are returned for the
//! theme author tooling (`scripts/validate-theme.mjs` mirrors these rules for the CLI).
//!
//! Errors: id not kebab-case or != folder name, engine != `aura-theme/1`, version not semver,
//! minAppVersion > current app version, referenced sound/shader/screenshot file missing,
//! any referenced path escaping the theme folder (`..`).
//! Warnings: missing sound slots, tokens missing `color.accent` / `color.background`.

use std::path::{Component, Path};

use super::manifest::{ThemeManifest, ENGINE, SOUND_SLOTS};
use crate::error::{CoreError, Result};

fn theme_err(msg: impl Into<String>) -> CoreError {
    CoreError::Theme(msg.into())
}

/// A referenced file must be relative, must not climb out of the theme folder, and must exist.
fn check_asset(dir: &Path, rel: &str, what: &str) -> Result<()> {
    let path = Path::new(rel);

    if rel.trim().is_empty() {
        return Err(theme_err(format!("{what} path is empty")));
    }
    if path.is_absolute() {
        return Err(theme_err(format!("{what} `{rel}` must be relative to the theme folder")));
    }
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(theme_err(format!("{what} `{rel}` escapes the theme folder")))
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(theme_err(format!("{what} `{rel}` must be relative to the theme folder")))
            }
            _ => {}
        }
    }
    if !dir.join(path).is_file() {
        return Err(theme_err(format!("{what} `{rel}` is missing")));
    }
    Ok(())
}

pub fn manifest(dir: &Path, m: &ThemeManifest, app_version: &str) -> Result<()> {
    if !is_kebab_case(&m.id) {
        return Err(theme_err(format!("theme id `{}` must be kebab-case", m.id)));
    }
    // The id doubles as the folder name so `locate(id)` is a plain path join.
    if let Some(folder) = dir.file_name().and_then(|n| n.to_str()) {
        if folder != m.id {
            return Err(theme_err(format!(
                "theme id `{}` must match its folder name `{folder}`",
                m.id
            )));
        }
    }
    if m.name.trim().is_empty() {
        return Err(theme_err("theme name must not be empty"));
    }
    if m.engine != ENGINE {
        return Err(theme_err(format!(
            "unsupported theme engine `{}` (expected `{ENGINE}`)",
            m.engine
        )));
    }

    let version = semver::Version::parse(m.version.trim())
        .map_err(|e| theme_err(format!("version `{}` is not semver: {e}", m.version)))?;
    let _ = version;

    if let Some(min) = m.min_app_version.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let min = semver::Version::parse(min)
            .map_err(|e| theme_err(format!("minAppVersion `{min}` is not semver: {e}")))?;
        let current = semver::Version::parse(app_version.trim())
            .map_err(|e| theme_err(format!("app version `{app_version}` is not semver: {e}")))?;
        if min > current {
            return Err(theme_err(format!(
                "theme needs Aura Shell {min} or newer (this is {current})"
            )));
        }
    }

    for (slot, rel) in &m.sounds {
        check_asset(dir, rel, &format!("sound `{slot}`"))?;
    }
    for (id, rel) in &m.shaders {
        check_asset(dir, rel, &format!("shader `{id}`"))?;
    }
    for rel in &m.screenshots {
        check_asset(dir, rel, "screenshot")?;
    }
    if m.has_css {
        check_asset(dir, "theme.css", "stylesheet")?;
    }

    Ok(())
}

/// Non-fatal notes about `tokens.json`.
pub fn tokens(tokens: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    for key in ["accent", "background"] {
        if tokens.get("color").and_then(|c| c.get(key)).is_none() {
            out.push(format!("tokens.json has no `color.{key}`; the built-in fallback is used"));
        }
    }
    out
}

/// Everything a theme author should know but that does not stop the theme loading.
pub fn warnings(m: &ThemeManifest, token_values: &serde_json::Value) -> Vec<String> {
    let mut out = tokens(token_values);
    for slot in SOUND_SLOTS {
        if !m.sounds.contains_key(slot) {
            out.push(format!("no `{slot}` sound; the default theme's sound is used"));
        }
    }
    out
}

pub fn is_kebab_case(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
        && !s.contains("--")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn base_manifest(id: &str) -> ThemeManifest {
        ThemeManifest {
            id: id.into(),
            name: "Test Theme".into(),
            author: "Someone".into(),
            version: "1.0.0".into(),
            description: String::new(),
            screenshots: vec![],
            min_app_version: None,
            engine: ENGINE.into(),
            sounds: BTreeMap::new(),
            shaders: BTreeMap::new(),
            has_css: false,
        }
    }

    /// A theme folder named after the id, so the folder-name rule is satisfied.
    fn theme_dir(tmp: &Path, id: &str) -> std::path::PathBuf {
        let dir = tmp.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn kebab_case_rules() {
        assert!(is_kebab_case("aura-default"));
        assert!(is_kebab_case("neon2"));
        assert!(!is_kebab_case(""));
        assert!(!is_kebab_case("Aura"));
        assert!(!is_kebab_case("aura_default"));
        assert!(!is_kebab_case("-aura"));
        assert!(!is_kebab_case("aura-"));
        assert!(!is_kebab_case("aura--default"));
    }

    #[test]
    fn a_minimal_manifest_is_valid() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "my-theme");
        assert!(manifest(&dir, &base_manifest("my-theme"), "0.1.0").is_ok());
    }

    #[test]
    fn rejects_bad_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "my-theme");

        assert!(manifest(&dir, &base_manifest("My_Theme"), "0.1.0").is_err(), "not kebab-case");
        assert!(manifest(&dir, &base_manifest("other-theme"), "0.1.0").is_err(), "folder mismatch");

        let mut m = base_manifest("my-theme");
        m.name = "  ".into();
        assert!(manifest(&dir, &m, "0.1.0").is_err(), "blank name");

        let mut m = base_manifest("my-theme");
        m.engine = "aura-theme/2".into();
        assert!(manifest(&dir, &m, "0.1.0").is_err(), "wrong engine");

        let mut m = base_manifest("my-theme");
        m.version = "one".into();
        assert!(manifest(&dir, &m, "0.1.0").is_err(), "not semver");
    }

    #[test]
    fn enforces_min_app_version() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "my-theme");

        let mut m = base_manifest("my-theme");
        m.min_app_version = Some("0.9.0".into());
        assert!(manifest(&dir, &m, "0.1.0").is_err(), "theme is newer than the app");
        assert!(manifest(&dir, &m, "1.0.0").is_ok(), "app is newer than the theme");

        m.min_app_version = Some("0.1.0".into());
        assert!(manifest(&dir, &m, "0.1.0").is_ok(), "exact match is fine");

        m.min_app_version = Some(String::new());
        assert!(manifest(&dir, &m, "0.1.0").is_ok(), "blank is treated as unset");
    }

    #[test]
    fn referenced_files_must_exist_inside_the_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "my-theme");

        let mut m = base_manifest("my-theme");
        m.sounds.insert("move".into(), "sounds/move.wav".into());
        assert!(manifest(&dir, &m, "0.1.0").is_err(), "declared but missing");

        std::fs::create_dir_all(dir.join("sounds")).unwrap();
        std::fs::write(dir.join("sounds").join("move.wav"), b"RIFF").unwrap();
        assert!(manifest(&dir, &m, "0.1.0").is_ok());

        // Path traversal must be refused even when the target exists.
        std::fs::write(tmp.path().join("outside.wav"), b"RIFF").unwrap();
        let mut escaping = base_manifest("my-theme");
        escaping.sounds.insert("move".into(), "../outside.wav".into());
        let err = manifest(&dir, &escaping, "0.1.0").unwrap_err();
        assert!(err.to_string().contains("escapes"), "got {err}");

        let mut absolute = base_manifest("my-theme");
        absolute.sounds.insert("move".into(), "/etc/passwd".into());
        assert!(manifest(&dir, &absolute, "0.1.0").is_err());
    }

    #[test]
    fn has_css_requires_the_stylesheet() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "my-theme");

        let mut m = base_manifest("my-theme");
        m.has_css = true;
        assert!(manifest(&dir, &m, "0.1.0").is_err());

        std::fs::write(dir.join("theme.css"), "/* */").unwrap();
        assert!(manifest(&dir, &m, "0.1.0").is_ok());
    }

    #[test]
    fn warnings_flag_missing_slots_and_colours() {
        let m = base_manifest("my-theme");
        let empty = serde_json::json!({});
        let notes = warnings(&m, &empty);
        assert!(notes.iter().any(|w| w.contains("color.accent")));
        assert!(notes.iter().any(|w| w.contains("color.background")));
        for slot in SOUND_SLOTS {
            assert!(notes.iter().any(|w| w.contains(slot)), "no warning for `{slot}`");
        }

        let complete = serde_json::json!({ "color": { "accent": "#fff", "background": "#000" } });
        assert!(tokens(&complete).is_empty());
    }
}
