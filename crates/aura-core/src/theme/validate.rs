//! Theme validation. Hard errors stop a theme from loading; warnings are returned for the
//! theme author tooling (`scripts/validate-theme.mjs` mirrors these rules for the CLI).
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-input-theme agent).
//! Errors: id not kebab-case or != folder name, engine != `aura-theme/1`, version not semver,
//! minAppVersion > current app version, referenced sound/shader/screenshot file missing,
//! any referenced path escaping the theme folder (`..`).
//! Warnings: missing sound slots, tokens missing `color.accent` / `color.background`.

use std::path::Path;

use super::manifest::ThemeManifest;
use crate::error::Result;

pub fn manifest(dir: &Path, m: &ThemeManifest, app_version: &str) -> Result<()> {
    let _ = (dir, m, app_version);
    todo!("theme::validate::manifest")
}

pub fn tokens(tokens: &serde_json::Value) -> Vec<String> {
    let _ = tokens;
    todo!("theme::validate::tokens")
}

pub fn is_kebab_case(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
        && !s.contains("--")
}
