//! Filesystem layout.
//!
//! ```text
//! %APPDATA%/AuraShell/            data_dir      (settings db, user themes)
//!   aura.db                       db_path
//!   themes/                       user_themes_dir
//!   logs/                         log_dir
//! %LOCALAPPDATA%/AuraShell/cache/ cache_dir
//!   artwork/                      artwork_dir
//! <install>/themes/               bundled_themes_dir (Tauri resource dir; ../themes in dev)
//! ```
//!
//! `AURA_DATA_DIR` overrides `data_dir` (and puts the cache beside it) - used by tests and
//! portable installs.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};

pub const APP_QUALIFIER: &str = "com";
pub const APP_ORG: &str = "aura";
pub const APP_NAME: &str = "AuraShell";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub artwork_dir: PathBuf,
    pub log_dir: PathBuf,
    pub db_path: PathBuf,
    pub bundled_themes_dir: PathBuf,
    pub user_themes_dir: PathBuf,
}

impl Paths {
    /// Resolve the standard per-user locations. `bundled_themes_dir` is supplied by the shell
    /// host because only it knows the Tauri resource directory.
    pub fn discover(bundled_themes_dir: PathBuf) -> Result<Paths> {
        if let Some(root) = std::env::var_os("AURA_DATA_DIR") {
            return Ok(Self::rooted(Path::new(&root), bundled_themes_dir));
        }
        let dirs = directories::ProjectDirs::from(APP_QUALIFIER, APP_ORG, APP_NAME)
            .ok_or_else(|| CoreError::Other("cannot resolve user directories".into()))?;
        let data_dir = dirs.data_dir().to_path_buf();
        let cache_dir = dirs.cache_dir().to_path_buf();
        Ok(Paths {
            db_path: data_dir.join("aura.db"),
            user_themes_dir: data_dir.join("themes"),
            log_dir: data_dir.join("logs"),
            artwork_dir: cache_dir.join("artwork"),
            data_dir,
            cache_dir,
            bundled_themes_dir,
        })
    }

    /// Everything under one root. Used by tests and `AURA_DATA_DIR`.
    pub fn rooted(root: &Path, bundled_themes_dir: PathBuf) -> Paths {
        let data_dir = root.to_path_buf();
        let cache_dir = root.join("cache");
        Paths {
            db_path: data_dir.join("aura.db"),
            user_themes_dir: data_dir.join("themes"),
            log_dir: data_dir.join("logs"),
            artwork_dir: cache_dir.join("artwork"),
            data_dir,
            cache_dir,
            bundled_themes_dir,
        }
    }

    /// Create every directory that does not exist yet.
    pub fn ensure(&self) -> Result<()> {
        for dir in [
            &self.data_dir,
            &self.cache_dir,
            &self.artwork_dir,
            &self.log_dir,
            &self.user_themes_dir,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rooted_layout_is_under_root() {
        let root = std::env::temp_dir().join("aura-paths-test");
        let p = Paths::rooted(&root, PathBuf::from("themes"));
        assert!(p.db_path.starts_with(&root));
        assert!(p.artwork_dir.starts_with(&root));
        assert_eq!(p.bundled_themes_dir, PathBuf::from("themes"));
    }
}
