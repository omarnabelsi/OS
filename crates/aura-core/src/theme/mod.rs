//! Theme service: discover theme folders (bundled + user), validate manifests, load bundles.
//! See `docs/THEME_FORMAT.md` for the package format.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-input-theme agent).
//! Resolution order for `load(id)`: user dir first (lets users override a bundled theme), then
//! bundled dir. `list()` returns bundled + user, de-duplicated by id (user wins).

pub mod loader;
pub mod manifest;
pub mod validate;

use std::path::PathBuf;

use crate::error::Result;
use crate::model::{ThemeBundle, ThemeInfo};

pub struct ThemeService {
    pub bundled_dir: PathBuf,
    pub user_dir: PathBuf,
}

impl ThemeService {
    pub fn new(bundled_dir: PathBuf, user_dir: PathBuf) -> Self {
        Self { bundled_dir, user_dir }
    }

    pub fn list(&self) -> Result<Vec<ThemeInfo>> {
        todo!("theme::ThemeService::list")
    }

    pub fn load(&self, id: &str) -> Result<ThemeBundle> {
        let _ = id;
        todo!("theme::ThemeService::load")
    }

    /// Folder for a theme id, if it exists in either location.
    pub fn locate(&self, id: &str) -> Option<(PathBuf, bool)> {
        let _ = id;
        todo!("theme::ThemeService::locate")
    }
}
