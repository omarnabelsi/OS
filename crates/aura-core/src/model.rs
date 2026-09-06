//! Shared data model. Every type here crosses the IPC bridge and therefore has a mirror in
//! `src/bridge/types.ts`. Serialisation is camelCase for fields and snake_case for enum
//! variants. Change both sides together and update `docs/IPC.md`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellMode {
    /// Explorer keeps running; Aura is a fullscreen window on top (V1/V2 default).
    Overlay,
    /// Aura is registered as the Winlogon shell (V2 opt-in, not implemented in V1).
    TrueShell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub cache_dir: String,
    pub artwork_dir: String,
    pub themes_dir: String,
    pub user_themes_dir: String,
    pub mode: ShellMode,
    /// True when started with `--smoke` (windowed, auto-exits). Used by CI and tests.
    pub smoke: bool,
}

// ---------------------------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Game,
    App,
    Link,
    Folder,
}

impl EntryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntryType::Game => "game",
            EntryType::App => "app",
            EntryType::Link => "link",
            EntryType::Folder => "folder",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "game" => Some(EntryType::Game),
            "app" => Some(EntryType::App),
            "link" => Some(EntryType::Link),
            "folder" => Some(EntryType::Folder),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Steam,
    Epic,
    Gog,
    Ea,
    Uwp,
    Manual,
}

impl Source {
    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Steam => "steam",
            Source::Epic => "epic",
            Source::Gog => "gog",
            Source::Ea => "ea",
            Source::Uwp => "uwp",
            Source::Manual => "manual",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "steam" => Some(Source::Steam),
            "epic" => Some(Source::Epic),
            "gog" => Some(Source::Gog),
            "ea" => Some(Source::Ea),
            "uwp" => Some(Source::Uwp),
            "manual" => Some(Source::Manual),
            _ => None,
        }
    }
}

/// How an entry is started. Stored as JSON in `entries.launch`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaunchSpec {
    /// Start an executable directly (CreateProcess).
    Exe {
        path: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
    },
    /// Open a protocol URI such as `steam://rungameid/620` or `com.epicgames.launcher://...`.
    Uri { uri: String },
    /// A shell target such as `shell:AppsFolder\Package!App` for Microsoft Store apps.
    Shell { target: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub source: Source,
    /// Store-specific id (Steam appid, Epic catalog id, ...). None for manual entries.
    pub source_id: Option<String>,
    pub launch: LaunchSpec,
    pub install_path: Option<String>,
    pub install_size: Option<u64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtworkKind {
    Grid,
    Hero,
    Logo,
    Icon,
}

impl ArtworkKind {
    pub const ALL: [ArtworkKind; 4] =
        [ArtworkKind::Grid, ArtworkKind::Hero, ArtworkKind::Logo, ArtworkKind::Icon];
    pub fn as_str(&self) -> &'static str {
        match self {
            ArtworkKind::Grid => "grid",
            ArtworkKind::Hero => "hero",
            ArtworkKind::Logo => "logo",
            ArtworkKind::Icon => "icon",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "grid" => Some(ArtworkKind::Grid),
            "hero" => Some(ArtworkKind::Hero),
            "logo" => Some(ArtworkKind::Logo),
            "icon" => Some(ArtworkKind::Icon),
            _ => None,
        }
    }
}

/// Absolute local paths of cached artwork. The UI turns them into `asset://` URLs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub grid: Option<String>,
    pub hero: Option<String>,
    pub logo: Option<String>,
    pub icon: Option<String>,
    /// Where the artwork came from: "steamgriddb", "steam_cdn", "user".
    pub source: Option<String>,
    /// True when the user replaced at least one asset manually; scanners must not overwrite.
    pub user_override: bool,
}

impl Artwork {
    pub fn get(&self, kind: ArtworkKind) -> Option<&str> {
        match kind {
            ArtworkKind::Grid => self.grid.as_deref(),
            ArtworkKind::Hero => self.hero.as_deref(),
            ArtworkKind::Logo => self.logo.as_deref(),
            ArtworkKind::Icon => self.icon.as_deref(),
        }
    }
    pub fn set(&mut self, kind: ArtworkKind, path: Option<String>) {
        match kind {
            ArtworkKind::Grid => self.grid = path,
            ArtworkKind::Hero => self.hero = path,
            ArtworkKind::Logo => self.logo = path,
            ArtworkKind::Icon => self.icon = path,
        }
    }
    pub fn is_complete(&self) -> bool {
        self.grid.is_some() && self.hero.is_some()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub playtime_secs: u64,
    pub launch_count: u32,
    pub last_played: Option<i64>,
    pub favourite: bool,
    pub hidden: bool,
}

/// What the UI renders: an entry joined with its artwork and stats.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    #[serde(flatten)]
    pub entry: Entry,
    pub artwork: Artwork,
    pub stats: Stats,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    #[default]
    Name,
    LastPlayed,
    Playtime,
    RecentlyAdded,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryFilter {
    #[serde(rename = "type")]
    pub entry_type: Option<EntryType>,
    pub source: Option<Source>,
    pub include_hidden: bool,
    pub favourites_only: bool,
    pub search: Option<String>,
    pub sort: SortKey,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddManualEntryInput {
    /// Defaults to the executable's file stem.
    pub name: Option<String>,
    pub path: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Defaults to `App`.
    #[serde(rename = "type")]
    pub entry_type: Option<EntryType>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateEntryPatch {
    pub name: Option<String>,
    pub hidden: Option<bool>,
    pub favourite: Option<bool>,
    pub launch: Option<LaunchSpec>,
}

/// Output of a store scanner before it is persisted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub source: Source,
    pub source_id: Option<String>,
    pub launch: LaunchSpec,
    pub install_path: Option<String>,
    pub install_size: Option<u64>,
}

// ---------------------------------------------------------------------------------------------
// Events payloads
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanStage {
    Queued,
    Discovering,
    Parsing,
    Saving,
    Done,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub job_id: String,
    pub source: Option<Source>,
    pub stage: ScanStage,
    pub found: u32,
    pub message: Option<String>,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUpdated {
    pub entry_ids: Vec<String>,
    /// "scan" | "manual_add" | "update" | "remove"
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkUpdated {
    pub entry_id: String,
    pub kind: ArtworkKind,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSession {
    pub session_id: String,
    pub entry_id: String,
    pub pid: Option<u32>,
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessExited {
    pub session_id: String,
    pub entry_id: String,
    pub exit_code: Option<i32>,
    pub duration_secs: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToastLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub level: ToastLevel,
    pub message: String,
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamepadEventKind {
    Connected,
    Disconnected,
    Button,
    Axis,
}

/// Normalised button names (Xbox layout positions, not glyphs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamepadButton {
    South,
    East,
    North,
    West,
    DpadUp,
    DpadDown,
    DpadLeft,
    DpadRight,
    LeftShoulder,
    RightShoulder,
    LeftTrigger,
    RightTrigger,
    Start,
    Select,
    Guide,
    LeftStick,
    RightStick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamepadAxis {
    LeftX,
    LeftY,
    RightX,
    RightY,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamepadEvent {
    pub gamepad_id: u32,
    pub kind: GamepadEventKind,
    pub button: Option<GamepadButton>,
    pub axis: Option<GamepadAxis>,
    /// Button: 0.0 / 1.0 (or analog trigger value). Axis: -1.0 ..= 1.0 after deadzone.
    pub value: f32,
    pub pressed: bool,
    pub name: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Shell host
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub primary: bool,
}

// ---------------------------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    /// Absolute paths to screenshot images inside the theme folder.
    pub screenshots: Vec<String>,
    /// Absolute path of the theme folder.
    pub path: String,
    pub builtin: bool,
    pub min_app_version: Option<String>,
}

/// Everything the UI needs to apply a theme, resolved to absolute paths / inline text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeBundle {
    pub info: ThemeInfo,
    /// `tokens.json` verbatim. Applied as CSS custom properties by the UI.
    pub tokens: serde_json::Value,
    /// `layout.json` verbatim. Which regions exist and what goes in them.
    pub layout: serde_json::Value,
    /// `theme.css` contents (may be empty).
    pub css: String,
    /// Sound name (`move`, `select`, `back`, `launch`, `error`) -> absolute file path.
    pub sounds: HashMap<String, String>,
    /// Shader id -> GLSL fragment source.
    pub shaders: HashMap<String, String>,
    /// Absolute path of `assets/`.
    pub assets_dir: String,
}
