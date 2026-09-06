//! `manifest.json` schema for a theme package.

use serde::{Deserialize, Serialize};

pub const ENGINE: &str = "aura-theme/1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    /// Kebab-case unique id, e.g. `aura-default`. Must equal the folder name.
    pub id: String,
    pub name: String,
    pub author: String,
    /// semver
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Relative paths inside the theme folder.
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Minimum Aura Shell version (semver) this theme supports.
    #[serde(default)]
    pub min_app_version: Option<String>,
    /// Format marker; must be `aura-theme/1`.
    #[serde(default = "default_engine")]
    pub engine: String,
    /// Sound name -> relative path, e.g. `{ "move": "sounds/move.wav" }`.
    #[serde(default)]
    pub sounds: std::collections::BTreeMap<String, String>,
    /// Shader id -> relative path, e.g. `{ "aurora": "shaders/aurora.frag" }`.
    #[serde(default)]
    pub shaders: std::collections::BTreeMap<String, String>,
    /// Whether the theme ships a `theme.css`.
    #[serde(default = "default_true")]
    pub has_css: bool,
}

fn default_engine() -> String {
    ENGINE.to_string()
}
fn default_true() -> bool {
    true
}

/// The five sound slots every theme should fill (missing ones fall back to the default theme).
pub const SOUND_SLOTS: [&str; 5] = ["move", "select", "back", "launch", "error"];
