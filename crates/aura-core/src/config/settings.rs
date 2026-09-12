//! User settings. Persisted as one JSON document in the `settings` table under the key
//! `core.settings`. Mirrors `Settings` in `src/bridge/types.ts`.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

pub const DEFAULT_THEME_ID: &str = "aura-default";

/// The exit hotkey.
///
/// NOT `Ctrl+Shift+Escape`, which was the default until it turned out Windows reserves it for Task
/// Manager: the OS consumes it before any application sees it, so `RegisterHotKey` refuses it on
/// every machine and the documented escape hatch never worked once. See [`is_reserved_hotkey`].
pub const DEFAULT_EXIT_HOTKEY: &str = "Ctrl+Alt+Q";

/// Accelerators the OS keeps for itself, lowercased and stripped of spaces.
///
/// Registering one of these always fails, so refusing them at the settings layer turns a silent
/// dead binding into an error the user can act on.
const RESERVED_HOTKEYS: [&str; 8] = [
    "ctrl+shift+escape", // Task Manager
    "ctrl+alt+delete",   // Secure Attention Sequence
    "ctrl+escape",       // Start menu
    "alt+tab",
    "alt+escape",
    "super+l", // Lock; also spelled Win/Meta/Cmd - normalised below
    "super+tab",
    "super+d",
];

/// True when Windows (or the desktop environment) will not hand this accelerator to an app.
///
/// Comparison is case-insensitive, whitespace-insensitive, and normalises the several spellings
/// the shortcut plugin accepts for the same modifier.
pub fn is_reserved_hotkey(accelerator: &str) -> bool {
    let normalised: String = accelerator
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_lowercase())
        .collect();
    let normalised = normalised
        .replace("control+", "ctrl+")
        .replace("cmdorctrl+", "ctrl+")
        .replace("command+", "super+")
        .replace("meta+", "super+")
        .replace("win+", "super+")
        .replace("delete", "del")
        .replace("escape", "esc");

    RESERVED_HOTKEYS
        .iter()
        .any(|r| r.replace("delete", "del").replace("escape", "esc") == normalised)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TileSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// What is rendered behind the UI.
///
/// Aura Shell has no audio playback beyond the short interface sounds in `src/sound`: there is
/// deliberately no way to play a soundtrack or any other music. A video wallpaper is therefore a
/// moving picture and nothing else - the variant carries no `muted` flag, so neither a setting nor
/// a (community, untrusted) theme can ask for its audio track. The UI hard-mutes the element to
/// match; see `src/components/Background.tsx`.
///
/// A `muted` key left over in a stored settings document or a theme's `layout.background` is
/// ignored rather than rejected, so old configs and older themes still load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WallpaperSetting {
    /// Use whatever the active theme declares in `layout.json`.
    #[default]
    Theme,
    Image {
        path: String,
    },
    Video {
        path: String,
    },
    /// A shader shipped by the active theme (`shaders/<id>.frag`).
    Shader {
        id: String,
    },
    Color {
        hex: String,
    },
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
    /// 0.0 ..= 1.0. Interface sounds only - there is no music track to set a level for.
    pub sound_volume: f32,
    pub sounds_enabled: bool,
    /// Global shortcut string in Tauri format, e.g. `Ctrl+Alt+Q`. Must not be OS-reserved.
    pub exit_hotkey: String,
    pub steamgriddb_api_key: Option<String>,
    pub hide_shell_on_launch: bool,
    pub start_fullscreen: bool,
    pub always_on_top: bool,
    /// Index into `get_monitors()`; None = primary.
    pub monitor_index: Option<u32>,
    pub gamepad_enabled: bool,
    pub reduce_motion: bool,
    pub blur_mode: BlurMode,
    pub scan_on_startup: bool,
    pub language: String,
    pub taskbar_visible: bool,
    pub taskbar_position: TaskbarPosition,
    pub taskbar_alignment: TaskbarAlignment,
}

/// How much backdrop blur the shell may use.
///
/// Blur is the most expensive thing the shell draws (docs/RISKS.md R12), and how much a machine
/// can afford is not knowable up front - the same integrated GPU is comfortable at 1080p and
/// struggles at 4K. So the default measures the frame rate and asks for less when it has to, and
/// this setting is the user's override in either direction.
///
/// A theme that sets `blur.surface: 0` is not a glass theme, and that wins over all three.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BlurMode {
    /// Full blur, stepping down if the frame rate cannot hold it.
    #[default]
    Auto,
    /// Never step down, however slow it gets.
    Full,
    /// No backdrop blur anywhere.
    Off,
}

/// Which edge the taskbar is docked to. This is Aura's own taskbar inside the shell window -
/// the real Windows taskbar is never moved or hidden (docs/RISKS.md R3, R13).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskbarPosition {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

/// Where the buttons sit along that edge. Windows 11 centres them; Windows 10 did not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskbarAlignment {
    Start,
    #[default]
    Center,
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
            sounds_enabled: true,
            exit_hotkey: DEFAULT_EXIT_HOTKEY.to_string(),
            steamgriddb_api_key: None,
            hide_shell_on_launch: true,
            start_fullscreen: true,
            always_on_top: false,
            monitor_index: None,
            gamepad_enabled: true,
            reduce_motion: false,
            blur_mode: BlurMode::Auto,
            scan_on_startup: true,
            language: "en".to_string(),
            taskbar_visible: true,
            taskbar_position: TaskbarPosition::Bottom,
            taskbar_alignment: TaskbarAlignment::Center,
        }
    }
}

impl Settings {
    /// Merge a partial JSON object into this settings value and validate the result.
    /// Unknown keys are rejected so typos in the UI surface immediately.
    pub fn apply_patch(&mut self, patch: serde_json::Value) -> Result<()> {
        let serde_json::Value::Object(patch) = patch else {
            return Err(CoreError::Invalid(
                "settings patch must be an object".into(),
            ));
        };
        let mut current = serde_json::to_value(&*self)?;
        let serde_json::Value::Object(ref mut map) = current else {
            unreachable!()
        };
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
            return Err(CoreError::Invalid(
                "uiScale must be between 0.5 and 2.0".into(),
            ));
        }
        if !(0.0..=1.0).contains(&self.sound_volume) {
            return Err(CoreError::Invalid(
                "soundVolume must be between 0 and 1".into(),
            ));
        }
        if let Some(hex) = &self.accent_color {
            if !is_hex_color(hex) {
                return Err(CoreError::Invalid(format!(
                    "accentColor `{hex}` is not a hex colour"
                )));
            }
        }
        if let WallpaperSetting::Color { hex } = &self.wallpaper {
            if !is_hex_color(hex) {
                return Err(CoreError::Invalid(format!(
                    "wallpaper colour `{hex}` is not a hex colour"
                )));
            }
        }
        if self.theme_id.trim().is_empty() {
            return Err(CoreError::Invalid("themeId must not be empty".into()));
        }
        if self.exit_hotkey.trim().is_empty() {
            return Err(CoreError::Invalid("exitHotkey must not be empty".into()));
        }
        if is_reserved_hotkey(&self.exit_hotkey) {
            return Err(CoreError::Invalid(format!(
                "`{}` is reserved by the operating system and can never be registered - \
                 pick another combination",
                self.exit_hotkey
            )));
        }
        Ok(())
    }
}

/// Replace an exit hotkey the OS will never grant with the default. True when it changed.
///
/// Existing installs have `Ctrl+Shift+Escape` written into their settings row from when that was
/// the default. Loading it back would leave the escape hatch dead on exactly the machines that
/// have been running longest, and the user has no reason to suspect the stored value is the
/// problem - so repair it once, on load.
pub fn repair_exit_hotkey(settings: &mut Settings) -> bool {
    if !is_reserved_hotkey(&settings.exit_hotkey) {
        return false;
    }
    settings.exit_hotkey = DEFAULT_EXIT_HOTKEY.to_string();
    true
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
        s.apply_patch(serde_json::json!({ "uiScale": 1.25, "tileSize": "large" }))
            .unwrap();
        assert_eq!(s.ui_scale, 1.25);
        assert_eq!(s.tile_size, TileSize::Large);
        assert!(s
            .apply_patch(serde_json::json!({ "uiScale": 9.0 }))
            .is_err());
        assert!(s.apply_patch(serde_json::json!({ "nope": 1 })).is_err());
        assert_eq!(s.ui_scale, 1.25, "failed patch must not partially apply");
    }

    #[test]
    fn the_default_exit_hotkey_is_one_an_app_can_actually_register() {
        let s = Settings::default();
        assert!(
            !is_reserved_hotkey(&s.exit_hotkey),
            "the default escape hatch must not be an OS-reserved combination"
        );
        s.validate().expect("the defaults must be valid");
    }

    #[test]
    fn reserved_hotkeys_are_refused_however_they_are_spelled() {
        for spelling in [
            "Ctrl+Shift+Escape",
            "ctrl+shift+escape",
            "Control+Shift+Escape",
            "CmdOrCtrl+Shift+Esc",
            " Ctrl + Shift + Escape ",
            "Ctrl+Alt+Delete",
            "Win+L",
            "Meta+L",
            "Alt+Tab",
        ] {
            assert!(
                is_reserved_hotkey(spelling),
                "`{spelling}` must be recognised as reserved"
            );
            let mut s = Settings::default();
            assert!(
                s.apply_patch(serde_json::json!({ "exitHotkey": spelling }))
                    .is_err(),
                "`{spelling}` must not be storable"
            );
        }
    }

    #[test]
    fn a_stored_reserved_hotkey_is_repaired_on_load() {
        // What an install created before Ctrl+Shift+Escape was known to be unusable looks like.
        let stored = serde_json::json!({ "exitHotkey": "Ctrl+Shift+Escape" });
        let mut loaded: Settings =
            serde_json::from_value(stored).expect("an old document must still load");
        assert_eq!(
            loaded.exit_hotkey, "Ctrl+Shift+Escape",
            "loading does not validate"
        );

        assert!(
            repair_exit_hotkey(&mut loaded),
            "a reserved hotkey must be reported as changed"
        );
        assert_eq!(loaded.exit_hotkey, DEFAULT_EXIT_HOTKEY);
        loaded
            .validate()
            .expect("the repaired document must be valid");

        // A hotkey the user deliberately chose is left alone.
        let mut fine = Settings {
            exit_hotkey: "Ctrl+Shift+F12".into(),
            ..Default::default()
        };
        assert!(!repair_exit_hotkey(&mut fine));
        assert_eq!(fine.exit_hotkey, "Ctrl+Shift+F12");
    }

    #[test]
    fn ordinary_combinations_are_allowed() {
        for ok in [
            "Ctrl+Alt+Q",
            "Ctrl+Shift+Q",
            "Alt+F4",
            "Ctrl+Alt+Backspace",
            "Ctrl+Shift+F12",
        ] {
            assert!(!is_reserved_hotkey(ok), "`{ok}` should be allowed");
            let mut s = Settings::default();
            s.apply_patch(serde_json::json!({ "exitHotkey": ok }))
                .expect("should store");
            assert_eq!(s.exit_hotkey, ok);
        }
    }

    #[test]
    fn wallpaper_is_tagged() {
        let w = WallpaperSetting::Video {
            path: "c:/x.mp4".into(),
        };
        let v = serde_json::to_value(&w).unwrap();
        assert_eq!(v["kind"], "video");
        let parsed: WallpaperSetting =
            serde_json::from_value(serde_json::json!({ "kind": "video", "path": "a" })).unwrap();
        assert_eq!(parsed, WallpaperSetting::Video { path: "a".into() });
    }

    /// The product rule: nothing can ask Aura Shell to play audio. A video wallpaper is a picture.
    #[test]
    fn a_video_wallpaper_cannot_carry_an_audio_request() {
        // A stored setting or an older theme's `layout.background` may still say `muted: false`.
        // It has to load - dropping the user's wallpaper would be worse - and it has to be
        // ignored, not honoured.
        let stored = serde_json::json!({ "kind": "video", "path": "c:/x.mp4", "muted": false });
        let parsed: WallpaperSetting = serde_json::from_value(stored).unwrap();
        assert_eq!(
            parsed,
            WallpaperSetting::Video {
                path: "c:/x.mp4".into()
            }
        );

        // And it must not come back on the way out, so nothing downstream can read it either.
        let out = serde_json::to_value(&parsed).unwrap();
        assert!(
            out.get("muted").is_none(),
            "serialised wallpaper must not mention audio"
        );
    }

    /// `musicVolume` is gone with it. An old settings row keeps loading; a live patch does not.
    #[test]
    fn music_volume_is_not_a_setting() {
        let stored = serde_json::json!({
            "themeId": "aura-default",
            "soundVolume": 0.5,
            "musicVolume": 0.9
        });
        let loaded: Settings = serde_json::from_value(stored).expect("an old document must load");
        assert_eq!(loaded.sound_volume, 0.5);

        let mut s = Settings::default();
        assert!(
            s.apply_patch(serde_json::json!({ "musicVolume": 0.9 }))
                .is_err(),
            "the UI must not be able to set a music level that does nothing"
        );
    }
}
