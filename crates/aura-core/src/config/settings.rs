//! User settings. Persisted as one JSON document in the `settings` table under the key
//! `core.settings`. Mirrors `Settings` in `src/bridge/types.ts`.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

pub const DEFAULT_THEME_ID: &str = "aura-default";
pub const DEFAULT_EXIT_HOTKEY: &str = "Ctrl+Shift+Escape";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TileSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// What is rendered behind the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WallpaperSetting {
    /// Use whatever the active theme declares in `layout.json`.
    Theme,
    Image {
        path: String,
    },
    Video {
        path: String,
        #[serde(default = "default_true")]
        muted: bool,
    },
    /// A shader shipped by the active theme (`shaders/<id>.frag`).
    Shader {
        id: String,
    },
    Color {
        hex: String,
    },
}

fn default_true() -> bool {
    true
}

impl Default for WallpaperSetting {
    fn default() -> Self {
        WallpaperSetting::Theme
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme_id: String,
    pub wallpaper: WallpaperSetting,
    /// Hex colour overriding the theme accent. None = theme default.
    pub accent_color: Option<String>,
    pub tile_size: TileSize,
    /// 0.5 ..= 2.0
    pub ui_scale: f32,
    /// 0.0 ..= 1.0
    pub sound_volume: f32,
    /// 0.0 ..= 1.0 (background music / video audio)
    pub music_volume: f32,
    pub sounds_enabled: bool,
    /// Global shortcut string in Tauri format, e.g. `Ctrl+Shift+Escape`.
    pub exit_hotkey: String,
    pub steamgriddb_api_key: Option<String>,
    pub hide_shell_on_launch: bool,
    pub start_fullscreen: bool,
    pub always_on_top: bool,
    /// Index into `get_monitors()`; None = primary.
    pub monitor_index: Option<u32>,
    pub gamepad_enabled: bool,
    pub reduce_motion: bool,
    pub scan_on_startup: bool,
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme_id: DEFAULT_THEME_ID.to_string(),
            wallpaper: WallpaperSetting::Theme,
            accent_color: None,
            tile_size: TileSize::Medium,
            ui_scale: 1.0,
            sound_volume: 0.6,
            music_volume: 0.3,
            sounds_enabled: true,
            exit_hotkey: DEFAULT_EXIT_HOTKEY.to_string(),
            steamgriddb_api_key: None,
            hide_shell_on_launch: true,
            start_fullscreen: true,
            always_on_top: false,
            monitor_index: None,
            gamepad_enabled: true,
            reduce_motion: false,
            scan_on_startup: true,
            language: "en".to_string(),
        }
    }
}

impl Settings {
    /// Merge a partial JSON object into this settings value and validate the result.
    /// Unknown keys are rejected so typos in the UI surface immediately.
    pub fn apply_patch(&mut self, patch: serde_json::Value) -> Result<()> {
        let serde_json::Value::Object(patch) = patch else {
            return Err(CoreError::Invalid("settings patch must be an object".into()));
        };
        let mut current = serde_json::to_value(&*self)?;
        let serde_json::Value::Object(ref mut map) = current else { unreachable!() };
        for (k, v) in patch {
            if !map.contains_key(&k) {
                return Err(CoreError::Invalid(format!("unknown setting `{k}`")));
            }
            map.insert(k, v);
        }
        let next: Settings = serde_json::from_value(current)?;
        next.validate()?;
        *self = next;
        Ok(())
    }

    pub fn validate(&self) -> Result<()> {
        if !(0.5..=2.0).contains(&self.ui_scale) {
            return Err(CoreError::Invalid("uiScale must be between 0.5 and 2.0".into()));
        }
        for (name, v) in [("soundVolume", self.sound_volume), ("musicVolume", self.music_volume)] {
            if !(0.0..=1.0).contains(&v) {
                return Err(CoreError::Invalid(format!("{name} must be between 0 and 1")));
            }
        }
        if let Some(hex) = &self.accent_color {
            if !is_hex_color(hex) {
                return Err(CoreError::Invalid(format!("accentColor `{hex}` is not a hex colour")));
            }
        }
        if let WallpaperSetting::Color { hex } = &self.wallpaper {
            if !is_hex_color(hex) {
                return Err(CoreError::Invalid(format!("wallpaper colour `{hex}` is not a hex colour")));
            }
        }
        if self.theme_id.trim().is_empty() {
            return Err(CoreError::Invalid("themeId must not be empty".into()));
        }
        if self.exit_hotkey.trim().is_empty() {
            return Err(CoreError::Invalid("exitHotkey must not be empty".into()));
        }
        Ok(())
    }
}

pub fn is_hex_color(s: &str) -> bool {
    let s = s.strip_prefix('#').unwrap_or(s);
    matches!(s.len(), 3 | 4 | 6 | 8) && s.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_round_trips() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn patch_merges_and_validates() {
        let mut s = Settings::default();
        s.apply_patch(serde_json::json!({ "uiScale": 1.25, "tileSize": "large" })).unwrap();
        assert_eq!(s.ui_scale, 1.25);
        assert_eq!(s.tile_size, TileSize::Large);
        assert!(s.apply_patch(serde_json::json!({ "uiScale": 9.0 })).is_err());
        assert!(s.apply_patch(serde_json::json!({ "nope": 1 })).is_err());
        assert_eq!(s.ui_scale, 1.25, "failed patch must not partially apply");
    }

    #[test]
    fn wallpaper_is_tagged() {
        let w = WallpaperSetting::Video { path: "c:/x.mp4".into(), muted: true };
        let v = serde_json::to_value(&w).unwrap();
        assert_eq!(v["kind"], "video");
        let parsed: WallpaperSetting = serde_json::from_value(serde_json::json!({ "kind": "video", "path": "a" })).unwrap();
        assert_eq!(parsed, WallpaperSetting::Video { path: "a".into(), muted: true });
    }
}
