//! Aura Shell core services.
//!
//! This crate is Layer 2 of the architecture ("Core services (native)"). It knows nothing about
//! Tauri or the UI. The shell host (`src-tauri`) owns a single [`Core`] and exposes its methods
//! over the IPC bridge (Layer 3). Long-running work (scanning, artwork download, process
//! watching) happens on background threads and reports back through an [`EventSink`].
//!
//! Module map (one directory per service, mirroring the plan's Layer 2 list):
//! - `config`   : filesystem paths and the user `Settings` model
//! - `db`       : SQLite schema, migrations and repositories (entries, artwork, stats, settings, themes)
//! - `library`  : store scanners (Steam in V1) and the manual-add path
//! - `artwork`  : SteamGridDB + Steam CDN fetch and the local artwork cache
//! - `process`  : launch an entry and watch its process tree until it exits
//! - `input`    : gamepad service (gilrs) emitting normalised events
//! - `theme`    : theme package discovery, validation and loading
//! - `media`    : wallpaper probing (playback itself happens in the UI layer in V1)
//! - `system`   : audio / network / power (V2 - stubs only)
//! - `files`    : IFileOperation file service (V2 - stubs only)

pub mod artwork;
pub mod config;
pub mod db;
pub mod desktop;
pub mod error;
pub mod events;
pub mod files;
pub mod input;
pub mod library;
pub mod media;
pub mod model;
pub mod process;
pub mod system;
pub mod theme;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use parking_lot::RwLock;

pub use config::paths::Paths;
pub use config::settings::{
    Settings, TaskbarAlignment, TaskbarPosition, TileSize, WallpaperSetting,
};
pub use error::{CoreError, Result};
pub use events::{CoreEvent, EventSink};
pub use model::*;
pub use system::SystemStatus;

/// The single entry point the shell host talks to. Always held as `Arc<Core>`.
pub struct Core {
    pub paths: Paths,
    pub db: db::Db,
    pub settings: RwLock<Settings>,
    pub sink: Arc<dyn EventSink>,
    pub http: reqwest::blocking::Client,
    pub process: process::ProcessService,
    pub themes: theme::ThemeService,
    pub input_stop: Arc<AtomicBool>,
}

impl Core {
    /// Open the database, run migrations, load settings and construct all services.
    pub fn new(paths: Paths, sink: Arc<dyn EventSink>) -> Result<Arc<Self>> {
        paths.ensure()?;
        let db = db::Db::open(&paths.db_path)?;
        // Before the schema moves, not after. docs/RISKS.md R8: playtime, favourites and
        // artwork overrides exist nowhere else.
        if let Some(backup) = db.backup_before_migration(&paths.db_path)? {
            tracing::info!("pre-migration backup at {}", backup.display());
        }
        db.migrate()?;
        let mut settings = db::settings::load(&db)?.unwrap_or_default();
        // One-time repair for installs carrying the old, unregistrable exit hotkey.
        if config::settings::repair_exit_hotkey(&mut settings) {
            tracing::warn!(
                "stored exit hotkey was OS-reserved; reset to {}",
                settings.exit_hotkey
            );
            db::settings::save(&db, &settings)?;
        }
        let http = reqwest::blocking::Client::builder()
            .user_agent(concat!("AuraShell/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| CoreError::Http(e.to_string()))?;
        let process = process::ProcessService::new(sink.clone());
        let themes = theme::ThemeService::new(
            paths.bundled_themes_dir.clone(),
            paths.user_themes_dir.clone(),
        );
        Ok(Arc::new(Self {
            paths,
            db,
            settings: RwLock::new(settings),
            sink,
            http,
            process,
            themes,
            input_stop: Arc::new(AtomicBool::new(false)),
        }))
    }

    // ---- app -----------------------------------------------------------------------------

    pub fn app_info(&self, version: &str, smoke: bool) -> AppInfo {
        AppInfo {
            version: version.to_string(),
            data_dir: self.paths.data_dir.display().to_string(),
            cache_dir: self.paths.cache_dir.display().to_string(),
            artwork_dir: self.paths.artwork_dir.display().to_string(),
            themes_dir: self.paths.bundled_themes_dir.display().to_string(),
            user_themes_dir: self.paths.user_themes_dir.display().to_string(),
            mode: ShellMode::Overlay,
            smoke,
        }
    }

    // ---- settings ------------------------------------------------------------------------

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    /// Apply a partial JSON patch (e.g. `{ "uiScale": 1.2 }`) to the settings, validate, persist.
    pub fn update_settings(&self, patch: serde_json::Value) -> Result<Settings> {
        let mut guard = self.settings.write();
        let mut next = guard.clone();
        next.apply_patch(patch)?;
        db::settings::save(&self.db, &next)?;
        *guard = next.clone();
        Ok(next)
    }

    // ---- library -------------------------------------------------------------------------

    pub fn list_entries(&self, filter: EntryFilter) -> Result<Vec<LibraryItem>> {
        library::list(self, &filter)
    }

    pub fn get_entry(&self, id: &str) -> Result<Option<LibraryItem>> {
        library::get(self, id)
    }

    /// Add a hand-picked program.
    ///
    /// A manual entry has no store id, so the only artwork that exists for it is the icon inside
    /// its own executable. That fetch is started here rather than inside `library::add_manual` so
    /// the library service stays free of background work, and so the user does not have to find
    /// "Find artwork" in the item menu to see a tile.
    pub fn add_manual_entry(self: &Arc<Self>, input: AddManualEntryInput) -> Result<LibraryItem> {
        let item = library::add_manual(self, input)?;
        artwork::start_fetch(self.clone(), item.entry.id.clone(), false);
        Ok(item)
    }

    pub fn update_entry(&self, id: &str, patch: UpdateEntryPatch) -> Result<LibraryItem> {
        library::update(self, id, patch)
    }

    pub fn remove_entry(&self, id: &str) -> Result<()> {
        library::remove(self, id)
    }

    /// Start a background scan. Returns the job id immediately; progress arrives as
    /// `library://scan-progress` events followed by `library://updated`.
    pub fn scan_library(self: &Arc<Self>, sources: Vec<Source>) -> String {
        library::start_scan(self.clone(), sources)
    }

    // ---- artwork -------------------------------------------------------------------------

    /// Fetch artwork for one entry in the background. Emits `library://artwork` per asset.
    pub fn fetch_artwork(self: &Arc<Self>, entry_id: String, force: bool) {
        artwork::start_fetch(self.clone(), entry_id, force)
    }

    pub fn set_artwork_override(
        &self,
        entry_id: &str,
        kind: ArtworkKind,
        path: &str,
    ) -> Result<Artwork> {
        artwork::set_override(self, entry_id, kind, path)
    }

    // ---- process -------------------------------------------------------------------------

    /// Launch an entry. Records launch stats, emits `process://started` now and
    /// `process://exited` when the process tree is gone.
    pub fn launch_entry(self: &Arc<Self>, entry_id: &str) -> Result<LaunchSession> {
        process::launch_entry(self.clone(), entry_id)
    }

    // ---- desktop -------------------------------------------------------------------------

    /// Create the default arrangement if this install has none. Safe on every start.
    pub fn seed_desktop(&self) -> Result<Option<Desktop>> {
        desktop::seed_if_empty(self)
    }

    pub fn list_desktops(&self) -> Result<Vec<Desktop>> {
        desktop::list_desktops(self)
    }

    pub fn get_desktop(&self, id: &str) -> Result<Option<Desktop>> {
        desktop::get_desktop(self, id)
    }

    pub fn create_desktop(&self, name: &str) -> Result<Desktop> {
        desktop::create_desktop(self, name)
    }

    pub fn update_desktop(&self, desktop: &Desktop) -> Result<Desktop> {
        desktop::update_desktop(self, desktop)
    }

    pub fn delete_desktop(&self, id: &str) -> Result<()> {
        desktop::delete_desktop(self, id)
    }

    pub fn list_desktop_items(&self, desktop_id: &str) -> Result<Vec<DesktopItem>> {
        desktop::list_items(self, desktop_id)
    }

    pub fn add_desktop_item(&self, input: NewDesktopItem) -> Result<DesktopItem> {
        desktop::add_item(self, input)
    }

    pub fn update_desktop_item(&self, id: &str, patch: DesktopItemPatch) -> Result<DesktopItem> {
        desktop::update_item(self, id, patch)
    }

    pub fn remove_desktop_item(&self, id: &str) -> Result<()> {
        desktop::remove_item(self, id)
    }

    // ---- folders -------------------------------------------------------------------------

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        desktop::list_folders(self)
    }

    pub fn get_folder(&self, id: &str) -> Result<Option<Folder>> {
        desktop::get_folder(self, id)
    }

    pub fn create_folder(&self, input: NewFolder) -> Result<Folder> {
        desktop::create_folder(self, input)
    }

    pub fn update_folder(&self, id: &str, patch: FolderPatch) -> Result<Folder> {
        desktop::update_folder(self, id, patch)
    }

    pub fn delete_folder(&self, id: &str) -> Result<()> {
        desktop::delete_folder(self, id)
    }

    /// What a folder resolves to: a smart filter's results, a collection's members, or (for a
    /// filesystem folder) nothing until the V2 file browser lands.
    pub fn folder_contents(&self, id: &str) -> Result<Vec<LibraryItem>> {
        desktop::folder_contents(self, id)
    }

    // ---- taskbar -------------------------------------------------------------------------

    pub fn list_taskbar_items(&self) -> Result<Vec<TaskbarItem>> {
        desktop::list_taskbar(self)
    }

    pub fn pin_to_taskbar(&self, target_id: &str) -> Result<TaskbarItem> {
        desktop::pin_to_taskbar(self, target_id)
    }

    pub fn unpin_from_taskbar(&self, target_id: &str) -> Result<()> {
        desktop::unpin_from_taskbar(self, target_id)
    }

    pub fn reorder_taskbar(&self, ids: Vec<String>) -> Result<()> {
        desktop::reorder_taskbar(self, &ids)
    }

    /// What the taskbar's system area shows. Infallible: a status read that failed shows
    /// nothing rather than taking the taskbar down with it.
    pub fn system_status(&self) -> system::SystemStatus {
        system::status()
    }

    // ---- themes --------------------------------------------------------------------------

    pub fn list_themes(&self) -> Result<Vec<ThemeInfo>> {
        self.themes.list()
    }

    pub fn get_theme(&self, id: &str) -> Result<ThemeBundle> {
        self.themes.load(id)
    }

    pub fn set_active_theme(&self, id: &str) -> Result<ThemeBundle> {
        let bundle = self.themes.load(id)?;
        self.update_settings(serde_json::json!({ "themeId": id }))?;
        self.sink.emit(CoreEvent::ThemeChanged {
            theme_id: id.to_string(),
        });
        Ok(bundle)
    }

    // ---- input ---------------------------------------------------------------------------

    /// Start the gamepad thread. Safe to call once per Core.
    pub fn start_input(self: &Arc<Self>) {
        input::start(self.sink.clone(), self.input_stop.clone());
    }

    pub fn stop_input(&self) {
        self.input_stop
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Current unix time in seconds. Shared helper for timestamps in the DB.
pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}
