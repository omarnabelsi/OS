//! Theme validation. Hard errors stop a theme from loading; warnings are returned for the
//! theme author tooling (`scripts/validate-theme.mjs` mirrors these rules for the CLI).
//!
//! Errors: id not kebab-case or != folder name, engine != `aura-theme/1`, version not semver,
//! minAppVersion > current app version, referenced sound/shader/screenshot file missing,
//! any referenced path escaping the theme folder (`..`), including from a `url()` in `theme.css`.
//! Warnings: missing sound slots, tokens missing `color.accent` / `color.background`, a
//! `theme.css` `url()` naming a file that is not there.

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
        return Err(theme_err(format!(
            "{what} `{rel}` must be relative to the theme folder"
        )));
    }
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(theme_err(format!(
                    "{what} `{rel}` escapes the theme folder"
                )))
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(theme_err(format!(
                    "{what} `{rel}` must be relative to the theme folder"
                )))
            }
            _ => {}
        }
    }
    if !dir.join(path).is_file() {
        return Err(theme_err(format!("{what} `{rel}` is missing")));
    }
    Ok(())
}

/// Drop any `folderShapes` entry that is malformed or points outside the theme folder.
///
/// `layout.json` is read as opaque JSON and handed to the UI, which turns asset paths into
/// `asset://` URLs. That makes it a path-traversal surface the moment anyone shares a theme
/// (docs/RISKS.md R5), and until folder shapes it referenced no files at all.
///
/// A bad entry is removed rather than failing the whole theme: neutralising it is what matters,
/// and one broken shape should not cost the user their whole desktop. Returns notes to log.
pub fn sanitise_folder_shapes(dir: &Path, layout: &mut serde_json::Value) -> Vec<String> {
    let mut notes = Vec::new();
    let Some(shapes) = layout
        .get_mut("folderShapes")
        .and_then(|s| s.as_array_mut())
    else {
        return notes;
    };

    shapes.retain(|shape| {
        let id = shape.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let asset = shape.get("asset").and_then(|v| v.as_str()).unwrap_or("");
        if id.trim().is_empty() {
            notes.push(format!("folder shape {shape} has no id; ignored"));
            return false;
        }
        if !is_kebab_case(id) {
            notes.push(format!(
                "folder shape id `{id}` must be kebab-case; ignored"
            ));
            return false;
        }
        if let Err(e) = check_asset(dir, asset, &format!("folder shape `{id}`")) {
            notes.push(format!("{e}; ignored"));
            return false;
        }
        true
    });

    // The geometry is separate: a shape with a bad radius is still a usable shape, so the bad
    // *field* is dropped and the shape kept.
    for shape in shapes.iter_mut() {
        let id = shape
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        sanitise_shape_geometry(&id, shape, &mut notes);
    }

    notes
}

/// Largest folder artwork dimension a theme may ask for, in CSS pixels at 1x scale.
///
/// Not a style judgement - a shape 40 000px tall would push every other item off the desktop and
/// there would be no way back except editing the database.
const MAX_SHAPE_PX: f64 = 1024.0;

/// Whether a `border-radius` value from a theme is safe to put in an inline style.
///
/// This is the important one. `layout.json` comes from a *shared* theme and this string is handed
/// to the UI, which writes it into a `style` attribute - so anything that can close a declaration
/// and start another is an injection (docs/RISKS.md R5). Only lengths, percentages, the `/` that
/// separates horizontal from vertical radii, and whitespace are allowed; no parentheses, so no
/// `url(...)`, no `var(...)`, no `calc(...)`, and no comment or statement punctuation.
pub fn is_safe_css_length_list(value: &str) -> bool {
    if value.trim().is_empty() || value.len() > 64 {
        return false;
    }
    let mut has_digit = false;
    for c in value.chars() {
        match c {
            '0'..='9' => has_digit = true,
            '.' | '%' | '/' | ' ' => {}
            'a'..='z' => {}
            _ => return false,
        }
    }
    has_digit
}

fn take_px(shape: &mut serde_json::Value, field: &str, id: &str, notes: &mut Vec<String>) {
    let Some(value) = shape.get(field) else {
        return;
    };
    let ok = value
        .as_f64()
        .is_some_and(|n| n.is_finite() && (0.0..=MAX_SHAPE_PX).contains(&n));
    if !ok {
        notes.push(format!(
            "folder shape `{id}`: `{field}` must be a number of pixels up to {MAX_SHAPE_PX}; ignored"
        ));
        shape.as_object_mut().map(|o| o.remove(field));
    }
}

fn take_radius(shape: &mut serde_json::Value, field: &str, id: &str, notes: &mut Vec<String>) {
    let Some(value) = shape.get(field) else {
        return;
    };
    let ok = value.as_str().is_some_and(is_safe_css_length_list);
    if !ok {
        notes.push(format!(
            "folder shape `{id}`: `{field}` must be lengths only (no functions or punctuation); ignored"
        ));
        shape.as_object_mut().map(|o| o.remove(field));
    }
}

/// Drop any geometry field a theme got wrong, keeping the shape itself.
fn sanitise_shape_geometry(id: &str, shape: &mut serde_json::Value, notes: &mut Vec<String>) {
    take_px(shape, "height", id, notes);
    take_px(shape, "offsetTop", id, notes);
    take_radius(shape, "radius", id, notes);

    let Some(tab) = shape.get_mut("tab") else {
        return;
    };
    if !tab.is_object() {
        notes.push(format!(
            "folder shape `{id}`: `tab` must be an object; ignored"
        ));
        shape.as_object_mut().map(|o| o.remove("tab"));
        return;
    }
    take_px(tab, "width", id, notes);
    take_px(tab, "height", id, notes);
    take_radius(tab, "radius", id, notes);
}

/// Relative `url(...)` targets in a stylesheet, in source order.
///
/// Skips what is already loadable or is not a file reference at all: a scheme of two or more
/// characters (`data:`, `https:`, `asset:`), a protocol-relative or absolute path, and the `#id`
/// form that points at an SVG filter in the same document. A single letter before the colon is
/// *not* treated as a scheme, so `url(C:/...)` is caught as the absolute path it is.
pub fn css_urls(css: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = css;
    while let Some(at) = rest.find("url(") {
        rest = &rest[at + "url(".len()..];
        let Some(end) = rest.find(')') else { break };
        let raw = rest[..end]
            .trim()
            .trim_matches(|c| c == '"' || c == '\'')
            .trim()
            .to_string();
        rest = &rest[end + 1..];
        if raw.is_empty() || is_already_resolved(&raw) {
            continue;
        }
        out.push(raw);
    }
    out
}

fn is_already_resolved(target: &str) -> bool {
    if target.starts_with('/') || target.starts_with('#') {
        return true;
    }
    match target.find(':') {
        // Two or more characters before the colon: a scheme. One is a Windows drive letter.
        Some(i) if i >= 2 => target[..i]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')),
        _ => false,
    }
}

/// Check one `url(...)` target from `theme.css`.
///
/// Escaping the theme folder is fatal: it is the same path-traversal surface as folder shapes
/// (docs/RISKS.md R5), and these paths are handed to the UI to turn into asset URLs. A *missing*
/// file is not fatal - the rule still applies and the browser falls back to the next font or
/// shows no image - so it comes back as a note instead of costing the user their theme.
pub fn css_asset(dir: &Path, rel: &str) -> Result<Option<String>> {
    let path = Path::new(rel);
    if path.is_absolute() || is_already_resolved(rel) || rel.contains(':') {
        return Err(theme_err(format!(
            "theme.css `url({rel})` must be a path relative to the theme folder"
        )));
    }
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(theme_err(format!(
                "theme.css `url({rel})` escapes the theme folder"
            )));
        }
    }
    if !dir.join(path).is_file() {
        return Ok(Some(format!(
            "theme.css references `{rel}`, which is missing; anything using it falls back"
        )));
    }
    Ok(None)
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

    if let Some(min) = m
        .min_app_version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
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
            out.push(format!(
                "tokens.json has no `color.{key}`; the built-in fallback is used"
            ));
        }
    }

    // A theme with no backdrop blur must not leave the focused window translucent: with nothing
    // blurred behind it, the desktop icons show straight through the window, which reads as a
    // rendering fault. Mirrored in scripts/validate-theme.mjs; see docs/THEME_FORMAT.md.
    let blur = token_number(tokens.get("blur").and_then(|b| b.get("surface")));
    let opacity = token_number(tokens.get("window").and_then(|w| w.get("opacity")));
    // An absent `window.opacity` means the shell's default, which is translucent.
    if blur == Some(0.0) && opacity.is_none_or(|o| o < 100.0) {
        out.push(
            "`blur.surface` is 0 but `window.opacity` is below 100%: the focused window will show \
             the desktop through it; set `window.opacity` to \"100%\""
                .into(),
        );
    }
    out
}

/// A token's numeric part: `0`, `"0px"`, `"62%"` and `"1.5rem"` all parse; anything else is None.
fn token_number(value: Option<&serde_json::Value>) -> Option<f64> {
    match value? {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s
            .trim()
            .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '%')
            .trim()
            .parse()
            .ok(),
        _ => None,
    }
}

/// Everything a theme author should know but that does not stop the theme loading.
pub fn warnings(m: &ThemeManifest, token_values: &serde_json::Value) -> Vec<String> {
    let mut out = tokens(token_values);
    for slot in SOUND_SLOTS {
        if !m.sounds.contains_key(slot) {
            out.push(format!(
                "no `{slot}` sound; the default theme's sound is used"
            ));
        }
    }
    out
}

pub fn is_kebab_case(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
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
    fn css_urls_finds_relative_references_only() {
        let css = r#"
            @font-face { src: url('assets/fonts/Manrope-latin.woff2') format('woff2'); }
            .a { background: url( "assets/bg.png" ); }
            .b { background: url(plain.svg); }
            .c { background: url(data:image/png;base64,AAA); }
            .d { background: url(https://example.com/x.png); }
            .e { background: url(asset://localhost/x.png); }
            .f { background: url(//cdn/x.png); }
            .g { background: url(/x.png); }
            .h { filter: url(#grain); }
        "#;
        assert_eq!(
            css_urls(css),
            vec![
                "assets/fonts/Manrope-latin.woff2",
                "assets/bg.png",
                "plain.svg"
            ]
        );
    }

    #[test]
    fn a_drive_letter_is_not_a_url_scheme() {
        // Two characters or more before the colon is a scheme; one is a Windows drive, and a
        // drive path must be caught rather than waved through as already loadable.
        assert_eq!(css_urls("a{background:url('C:/games/x.png')}").len(), 1);
        let tmp = tempfile::tempdir().unwrap();
        assert!(css_asset(tmp.path(), "C:/games/x.png").is_err());
    }

    #[test]
    fn css_url_escaping_the_theme_folder_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "aura-test");

        for bad in [
            "../../../Windows/Fonts/arial.ttf",
            "/etc/passwd",
            "C:\\Windows\\Fonts\\arial.ttf",
        ] {
            assert!(css_asset(&dir, bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_missing_css_file_is_a_note_not_an_error() {
        // The rule still applies and the browser falls back to the next font, so losing the whole
        // theme over it would be the worse outcome.
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "aura-test");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets").join("here.woff2"), b"wOF2").unwrap();

        assert_eq!(css_asset(&dir, "assets/here.woff2").unwrap(), None);
        assert!(css_asset(&dir, "assets/gone.woff2").unwrap().is_some());
    }

    #[test]
    fn a_radius_may_only_be_lengths() {
        for good in [
            "28px",
            "56px",
            "6px 28px 28px 28px",
            "10px 10px 0 0",
            "50%",
            "2px / 3px",
        ] {
            assert!(is_safe_css_length_list(good), "{good} should be allowed");
        }
        // The ones that matter: anything that could close this declaration and open another, or
        // reach a URL. These arrive from a shared theme and end up in a `style` attribute.
        for bad in [
            "url(evil.png)",
            "var(--x)",
            "calc(100% - 2px)",
            "28px; background: red",
            "28px} .a {color: red",
            "28px !important",
            "",
            "   ",
        ] {
            assert!(!is_safe_css_length_list(bad), "{bad} should be refused");
        }
    }

    #[test]
    fn a_bad_geometry_field_is_dropped_and_the_shape_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "aura-test");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets").join("a.svg"), b"<svg/>").unwrap();

        let mut layout = serde_json::json!({
            "folderShapes": [{
                "id": "capsule",
                "asset": "assets/a.svg",
                "height": 104,
                "radius": "56px; position: fixed",
                "offsetTop": 99999,
                "tab": { "width": 84, "radius": "url(x)" }
            }]
        });

        let notes = sanitise_folder_shapes(&dir, &mut layout);
        let shape = &layout["folderShapes"][0];

        // The shape survives; only the fields it got wrong are gone.
        assert_eq!(shape["id"], "capsule");
        assert_eq!(shape["height"], 104);
        assert!(shape.get("radius").is_none(), "dangerous radius kept");
        assert!(shape.get("offsetTop").is_none(), "out-of-range size kept");
        assert!(
            shape["tab"].get("radius").is_none(),
            "dangerous tab radius kept"
        );
        assert_eq!(shape["tab"]["width"], 84);
        assert_eq!(
            notes.len(),
            3,
            "each dropped field should be reported: {notes:?}"
        );
    }

    #[test]
    fn a_tab_that_is_not_an_object_is_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = theme_dir(tmp.path(), "aura-test");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets").join("a.svg"), b"<svg/>").unwrap();

        let mut layout = serde_json::json!({
            "folderShapes": [{ "id": "s", "asset": "assets/a.svg", "tab": "yes" }]
        });
        sanitise_folder_shapes(&dir, &mut layout);
        assert!(layout["folderShapes"][0].get("tab").is_none());
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

        assert!(
            manifest(&dir, &base_manifest("My_Theme"), "0.1.0").is_err(),
            "not kebab-case"
        );
        assert!(
            manifest(&dir, &base_manifest("other-theme"), "0.1.0").is_err(),
            "folder mismatch"
        );

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
        assert!(
            manifest(&dir, &m, "0.1.0").is_err(),
            "theme is newer than the app"
        );
        assert!(
            manifest(&dir, &m, "1.0.0").is_ok(),
            "app is newer than the theme"
        );

        m.min_app_version = Some("0.1.0".into());
        assert!(manifest(&dir, &m, "0.1.0").is_ok(), "exact match is fine");

        m.min_app_version = Some(String::new());
        assert!(
            manifest(&dir, &m, "0.1.0").is_ok(),
            "blank is treated as unset"
        );
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
        escaping
            .sounds
            .insert("move".into(), "../outside.wav".into());
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
            assert!(
                notes.iter().any(|w| w.contains(slot)),
                "no warning for `{slot}`"
            );
        }

        let complete = serde_json::json!({ "color": { "accent": "#fff", "background": "#000" } });
        assert!(tokens(&complete).is_empty());
    }

    #[test]
    fn no_blur_with_a_translucent_window_is_flagged() {
        let colours = serde_json::json!({ "accent": "#fff", "background": "#000" });
        let glass_without_blur = |opacity: Option<&str>| {
            let mut t = serde_json::json!({ "color": colours, "blur": { "surface": "0px" } });
            if let Some(o) = opacity {
                t["window"] = serde_json::json!({ "opacity": o });
            }
            tokens(&t)
        };

        // The shell's default opacity is translucent, so leaving it out is the same mistake.
        assert!(glass_without_blur(None)
            .iter()
            .any(|w| w.contains("window.opacity")));
        assert!(glass_without_blur(Some("62%"))
            .iter()
            .any(|w| w.contains("window.opacity")));
        // Opaque is the fix, and must not be flagged.
        assert!(glass_without_blur(Some("100%")).is_empty());

        // With a real blur, translucency is glass and is fine.
        let glass = serde_json::json!({
            "color": colours,
            "blur": { "surface": "18px" },
            "window": { "opacity": "62%" }
        });
        assert!(tokens(&glass).is_empty());
    }

    #[test]
    fn token_numbers_parse_with_or_without_units() {
        assert_eq!(token_number(Some(&serde_json::json!(0))), Some(0.0));
        assert_eq!(token_number(Some(&serde_json::json!("0px"))), Some(0.0));
        assert_eq!(token_number(Some(&serde_json::json!("62%"))), Some(62.0));
        assert_eq!(
            token_number(Some(&serde_json::json!(" 1.5rem "))),
            Some(1.5)
        );
        assert_eq!(token_number(Some(&serde_json::json!("auto"))), None);
        assert_eq!(token_number(None), None);
    }
}
