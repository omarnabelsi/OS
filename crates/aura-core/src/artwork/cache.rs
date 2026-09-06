//! Local artwork cache on disk: `<artwork_dir>/<entry_id>/<kind>-<sha256(url)[..16]>.<ext>`.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-artwork agent).
//! Downloads must be atomic (write to `.part`, then rename) and must reject non-image content
//! types and files > 25 MB.

use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::model::ArtworkKind;

pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// Deterministic cache location for a remote asset.
pub fn cache_path(artwork_dir: &Path, entry_id: &str, kind: ArtworkKind, url: &str) -> PathBuf {
    let _ = (artwork_dir, entry_id, kind, url);
    todo!("artwork::cache::cache_path")
}

/// Location for a user-supplied file copied into the cache.
pub fn override_path(artwork_dir: &Path, entry_id: &str, kind: ArtworkKind, source_file: &Path) -> PathBuf {
    let _ = (artwork_dir, entry_id, kind, source_file);
    todo!("artwork::cache::override_path")
}

/// Download `url` to `dest` atomically. Returns Ok(false) on 404, Ok(true) on success.
pub fn download(http: &reqwest::blocking::Client, url: &str, dest: &Path) -> Result<bool> {
    let _ = (http, url, dest);
    todo!("artwork::cache::download")
}

/// File extension guess from URL path or content type ("jpg" | "png" | "webp" | "gif" | "ico").
pub fn extension_for(url: &str, content_type: Option<&str>) -> &'static str {
    let _ = (url, content_type);
    todo!("artwork::cache::extension_for")
}
