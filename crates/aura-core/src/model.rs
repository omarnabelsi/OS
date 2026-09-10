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
    /// Where the artwork came from: "steamgriddb", "steam_cdn", "exe_icon", "user".
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
// Desktop
// ---------------------------------------------------------------------------------------------

/// How a desktop arranges the items placed on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridSettings {
    /// Cell size in logical pixels. Item positions are in cells, so this can change freely.
    pub cell: u32,
    pub gap: u32,
    pub snap: bool,
    /// Reflow items into reading order instead of honouring their stored positions.
    pub auto_arrange: bool,
}

impl Default for GridSettings {
    fn default() -> Self {
        GridSettings { cell: 96, gap: 16, snap: true, auto_arrange: false }
    }
}

/// One named arrangement of items over the wallpaper.
///
/// Plural from the start even though the seeded install has exactly one: retrofitting multiple
/// workspaces onto a single-desktop model means touching every query that reads an item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Desktop {
    pub id: String,
    pub name: String,
    /// Overrides the wallpaper from settings/theme for this desktop only. None = inherit.
    pub wallpaper: Option<crate::config::settings::WallpaperSetting>,
    pub grid: GridSettings,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DesktopItemKind {
    /// Launches an `entries` row.
    #[default]
    Shortcut,
    /// Opens a `folders` row in a window.
    Folder,
    /// A theme-declared widget, addressed by id in `target_id`.
    Widget,
    /// Visual spacer; has no target.
    Separator,
}

impl DesktopItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            DesktopItemKind::Shortcut => "shortcut",
            DesktopItemKind::Folder => "folder",
            DesktopItemKind::Widget => "widget",
            DesktopItemKind::Separator => "separator",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "shortcut" => Some(DesktopItemKind::Shortcut),
            "folder" => Some(DesktopItemKind::Folder),
            "widget" => Some(DesktopItemKind::Widget),
            "separator" => Some(DesktopItemKind::Separator),
            _ => None,
        }
    }
}

/// Something the user has placed on a desktop.
///
/// `x`/`y`/`width`/`height` are **grid cells, never pixels**. Someone who arranges their desktop
/// at 1080p and then plugs in a 4K panel must not find everything heaped in one corner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopItem {
    pub id: String,
    pub desktop_id: String,
    pub kind: DesktopItemKind,
    /// `entries.id`, `folders.id` or a widget id, depending on `kind`.
    pub target_id: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub label_override: Option<String>,
    pub icon_override: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewDesktopItem {
    pub desktop_id: String,
    pub kind: Option<DesktopItemKind>,
    pub target_id: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub label_override: Option<String>,
    pub icon_override: Option<String>,
}

/// Every field optional: absent means "leave alone", so a drag can send only `x`/`y`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopItemPatch {
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub label_override: Option<String>,
    pub icon_override: Option<String>,
    pub sort_order: Option<i64>,
}

// ---------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------

/// What a folder actually contains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FolderKind {
    /// A real path on disk. The file browser is V2; the row can exist before it lands.
    #[default]
    Filesystem,
    /// A hand-made group, backed by `collection_items`.
    Collection,
    /// A saved `EntryFilter` - "everything from Steam", "never played".
    Smart,
}

impl FolderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            FolderKind::Filesystem => "filesystem",
            FolderKind::Collection => "collection",
            FolderKind::Smart => "smart",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "filesystem" => Some(FolderKind::Filesystem),
            "collection" => Some(FolderKind::Collection),
            "smart" => Some(FolderKind::Smart),
            _ => None,
        }
    }
}

/// How a folder lays its contents out once open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FolderLayout {
    #[default]
    Grid,
    List,
    Covers,
}

/// Where a folder's window was when it was last closed, so reopening restores it.
///
/// Persisted per folder rather than in the window manager, and only written on close/settle -
/// never on a drag frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderWindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximised: bool,
}

/// A folder on the desktop: skinnable, openable in a window.
///
/// `path` is the unique locator and is `NOT NULL` in the v1 schema, so virtual folders use a
/// scheme prefix rather than a filesystem path: `smart:all-games`, `collection:<uuid>`. That
/// keeps the migration additive and the uniqueness constraint meaningful.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub path: String,
    pub label: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub cover: Option<String>,
    pub layout: FolderLayout,
    /// A shape id the active theme declares in `layout.json` `folderShapes`.
    pub shape: Option<String>,
    pub kind: FolderKind,
    pub collection_id: Option<String>,
    pub filter: Option<EntryFilter>,
    pub window_state: Option<FolderWindowState>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewFolder {
    pub path: Option<String>,
    pub label: Option<String>,
    pub kind: Option<FolderKind>,
    pub collection_id: Option<String>,
    pub filter: Option<EntryFilter>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub cover: Option<String>,
    pub shape: Option<String>,
    pub layout: Option<FolderLayout>,
}

/// The folder editor's patch.
///
/// Each clearable field has three states, because the editor needs all three: an absent key
/// leaves the field alone (`None`), `null` clears it (`Some(None)`), and a value sets it
/// (`Some(Some(v))`). With a plain `Option` the last two collapsed - JSON `null` deserialised to
/// `None`, which reads as "unchanged" - so a colour, a cover or a label, once set, could never be
/// removed again. `layout` and `sort_order` always have a value, so they stay a plain `Option`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderPatch {
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub label: Option<Option<String>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub color: Option<Option<String>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub icon: Option<Option<String>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub cover: Option<Option<String>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub shape: Option<Option<String>>,
    pub layout: Option<FolderLayout>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub filter: Option<Option<EntryFilter>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<Option<String>>,
    #[serde(deserialize_with = "double_option", skip_serializing_if = "Option::is_none")]
    pub window_state: Option<Option<FolderWindowState>>,
    pub sort_order: Option<i64>,
}

/// Deserialise a present key into `Some(..)`, so an explicit `null` becomes `Some(None)` and can
/// be told apart from an absent key, which the container's `#[serde(default)]` leaves as `None`.
fn double_option<'de, T, D>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ---------------------------------------------------------------------------------------------
// Taskbar
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskbarItemKind {
    /// Persisted by the user. Running state is derived live, never stored.
    Pinned,
    /// Clock, volume and friends - a marker, rendered by the UI.
    SystemArea,
    /// The launcher / start button.
    Launcher,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarItem {
    pub id: String,
    pub kind: TaskbarItemKind,
    /// `entries.id` for a pinned app or game, `folders.id` for a pinned folder.
    pub target_id: Option<String>,
    pub sort_order: i64,
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

/// Payload of `desktop://updated`. `reason` is for logging and debugging, not for branching:
/// the UI reloads the arrangement whatever the reason.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdated {
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
