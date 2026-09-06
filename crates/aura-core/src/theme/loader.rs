//! Read a theme folder into a `ThemeBundle`.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-input-theme agent).
//! Steps: read+parse `manifest.json` (Theme error on failure) -> `validate::manifest` ->
//! read `tokens.json`, `layout.json` (default `{}` if absent), `theme.css` (default "") ->
//! resolve sounds/shaders to absolute paths, read shader sources -> `ThemeBundle`.

use std::path::Path;

use super::manifest::ThemeManifest;
use crate::error::Result;
use crate::model::{ThemeBundle, ThemeInfo};

pub fn read_manifest(dir: &Path) -> Result<ThemeManifest> {
    let _ = dir;
    todo!("theme::loader::read_manifest")
}

pub fn info_from_manifest(dir: &Path, manifest: &ThemeManifest, builtin: bool) -> ThemeInfo {
    let _ = (dir, manifest, builtin);
    todo!("theme::loader::info_from_manifest")
}

pub fn load_from_dir(dir: &Path, builtin: bool) -> Result<ThemeBundle> {
    let _ = (dir, builtin);
    todo!("theme::loader::load_from_dir")
}
