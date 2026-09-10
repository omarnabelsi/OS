//! Theme service: discover theme folders (bundled + user), validate manifests, load bundles.
//! See `docs/THEME_FORMAT.md` for the package format.
//!
//! Resolution order for `load(id)`: user dir first (so a user can override a bundled theme),
//! then the bundled dir. `list()` returns bundled + user, de-duplicated by id (user wins).

pub mod loader;
pub mod manifest;
pub mod validate;

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::model::{ThemeBundle, ThemeInfo};

/// The app version themes declare `minAppVersion` against.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct ThemeService {
    pub bundled_dir: PathBuf,
    pub user_dir: PathBuf,
}

/// Every immediate subdirectory that holds a `manifest.json`.
fn theme_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join(loader::MANIFEST_FILE).is_file())
        .collect();
    out.sort();
    out
}

impl ThemeService {
    pub fn new(bundled_dir: PathBuf, user_dir: PathBuf) -> Self {
        Self {
            bundled_dir,
            user_dir,
        }
    }

    pub fn list(&self) -> Result<Vec<ThemeInfo>> {
        let mut out: Vec<ThemeInfo> = Vec::new();

        // Bundled first, then user - a user theme with the same id replaces the bundled one.
        for (root, builtin) in [(&self.bundled_dir, true), (&self.user_dir, false)] {
            for dir in theme_dirs(root) {
                let manifest = match loader::read_manifest(&dir) {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!("skipping theme at {}: {e}", dir.display());
                        continue;
                    }
                };
                if let Err(e) = validate::manifest(&dir, &manifest, APP_VERSION) {
                    tracing::warn!("skipping theme `{}`: {e}", manifest.id);
                    continue;
                }
                let info = loader::info_from_manifest(&dir, &manifest, builtin);
                match out.iter().position(|existing| existing.id == info.id) {
                    Some(i) => out[i] = info,
                    None => out.push(info),
                }
            }
        }

        out.sort_by_key(|t| t.name.to_lowercase());
        Ok(out)
    }

    pub fn load(&self, id: &str) -> Result<ThemeBundle> {
        let (dir, builtin) = self
            .locate(id)
            .ok_or_else(|| CoreError::NotFound(format!("theme `{id}`")))?;
        loader::load_from_dir(&dir, builtin)
    }

    /// Folder for a theme id, if it exists in either location. Returns `(dir, builtin)`.
    pub fn locate(&self, id: &str) -> Option<(PathBuf, bool)> {
        // Reject anything that could turn into a path traversal before touching the disk.
        if !validate::is_kebab_case(id) {
            return None;
        }
        let user = self.user_dir.join(id);
        if user.join(loader::MANIFEST_FILE).is_file() {
            return Some((user, false));
        }
        let bundled = self.bundled_dir.join(id);
        if bundled.join(loader::MANIFEST_FILE).is_file() {
            return Some((bundled, true));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_theme(root: &Path, id: &str, name: &str, version: &str) -> PathBuf {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(loader::MANIFEST_FILE),
            format!(
                r#"{{"id":"{id}","name":"{name}","author":"x","version":"{version}","hasCss":false}}"#
            ),
        )
        .unwrap();
        // r##"..."## because the JSON contains `"#` (a hex colour), which would close an r#".
        std::fs::write(dir.join("tokens.json"), r##"{"color":{"accent":"#fff"}}"##).unwrap();
        dir
    }

    fn service(tmp: &Path) -> ThemeService {
        let bundled = tmp.join("bundled");
        let user = tmp.join("user");
        std::fs::create_dir_all(&bundled).unwrap();
        std::fs::create_dir_all(&user).unwrap();
        ThemeService::new(bundled, user)
    }

    #[test]
    fn lists_bundled_and_user_themes_sorted() {
        let tmp = tempfile::tempdir().unwrap();
        let svc = service(tmp.path());
        write_theme(&svc.bundled_dir, "aura-default", "Aura", "1.0.0");
        write_theme(&svc.user_dir, "neon-city", "Neon City", "0.2.0");

        let list = svc.list().unwrap();
        assert_eq!(
            list.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["aura-default", "neon-city"]
        );
        assert!(list[0].builtin);
        assert!(!list[1].builtin);
    }

    #[test]
    fn a_user_theme_overrides_a_bundled_one_with_the_same_id() {
        let tmp = tempfile::tempdir().unwrap();
        let svc = service(tmp.path());
        write_theme(&svc.bundled_dir, "aura-default", "Bundled Aura", "1.0.0");
        write_theme(&svc.user_dir, "aura-default", "My Aura", "9.9.9");

        let list = svc.list().unwrap();
        assert_eq!(list.len(), 1, "the id must not appear twice");
        assert_eq!(list[0].name, "My Aura");
        assert!(!list[0].builtin);

        let (_, builtin) = svc.locate("aura-default").unwrap();
        assert!(!builtin, "locate must prefer the user copy too");
        assert_eq!(svc.load("aura-default").unwrap().info.version, "9.9.9");
    }

    #[test]
    fn invalid_themes_are_skipped_not_fatal() {
        let tmp = tempfile::tempdir().unwrap();
        let svc = service(tmp.path());
        write_theme(&svc.bundled_dir, "good-theme", "Good", "1.0.0");

        // Folder name and id disagree - validation rejects it.
        let bad = svc.bundled_dir.join("mismatch");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(
            bad.join(loader::MANIFEST_FILE),
            r#"{"id":"other-id","name":"Bad","author":"x","version":"1.0.0","hasCss":false}"#,
        )
        .unwrap();

        // Not JSON at all.
        let broken = svc.bundled_dir.join("broken");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join(loader::MANIFEST_FILE), "{{{").unwrap();

        let list = svc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "good-theme");
    }

    #[test]
    fn locate_refuses_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let svc = service(tmp.path());
        write_theme(&svc.bundled_dir, "aura-default", "Aura", "1.0.0");

        assert!(svc.locate("../../etc").is_none());
        assert!(svc.locate("..").is_none());
        assert!(
            svc.locate("Aura-Default").is_none(),
            "ids are kebab-case only"
        );
        assert!(svc.locate("aura-default").is_some());
    }

    #[test]
    fn loading_an_unknown_theme_is_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let svc = service(tmp.path());
        assert!(matches!(svc.load("nope"), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn missing_theme_directories_are_not_an_error() {
        let svc = ThemeService::new(PathBuf::from("Z:/no/bundled"), PathBuf::from("Z:/no/user"));
        assert!(svc.list().unwrap().is_empty());
    }
}
