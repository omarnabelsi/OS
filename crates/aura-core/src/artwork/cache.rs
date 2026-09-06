//! Local artwork cache on disk: `<artwork_dir>/<entry_id>/<kind>-<sha256(url)[..16]>.<ext>`.
//!
//! Downloads are atomic (write to `.part`, then rename) and reject non-image content types
//! and files larger than [`MAX_BYTES`].

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{CoreError, Result};
use crate::model::ArtworkKind;

pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// First 16 hex characters of the SHA-256 of `s` - short enough for a filename, long enough
/// that two artwork URLs will not collide.
fn short_hash(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

/// Deterministic cache location for a remote asset.
pub fn cache_path(artwork_dir: &Path, entry_id: &str, kind: ArtworkKind, url: &str) -> PathBuf {
    let ext = extension_for(url, None);
    artwork_dir
        .join(entry_id)
        .join(format!("{}-{}.{ext}", kind.as_str(), short_hash(url)))
}

/// Location for a user-supplied file copied into the cache. Hashing the source path keeps this
/// pure (and testable) while still giving a different file a different cache entry.
pub fn override_path(
    artwork_dir: &Path,
    entry_id: &str,
    kind: ArtworkKind,
    source_file: &Path,
) -> PathBuf {
    let source = source_file.to_string_lossy().to_string();
    let ext = extension_for(&source, None);
    artwork_dir
        .join(entry_id)
        .join(format!("{}-user-{}.{ext}", kind.as_str(), &short_hash(&source)[..8]))
}

/// File extension guess from URL path or content type ("jpg" | "png" | "webp" | "gif" | "ico").
pub fn extension_for(url: &str, content_type: Option<&str>) -> &'static str {
    if let Some(ct) = content_type {
        let ct = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        match ct.as_str() {
            "image/jpeg" | "image/jpg" => return "jpg",
            "image/png" => return "png",
            "image/webp" => return "webp",
            "image/gif" => return "gif",
            "image/x-icon" | "image/vnd.microsoft.icon" => return "ico",
            _ => {}
        }
    }

    // Strip the query/fragment, then look at the last path segment only.
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let last = path.rsplit(['/', '\\']).next().unwrap_or("");
    let ext = match last.rsplit_once('.') {
        Some((_, e)) => e.to_ascii_lowercase(),
        None => String::new(),
    };
    match ext.as_str() {
        "jpg" | "jpeg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        "gif" => "gif",
        "ico" => "ico",
        _ => "jpg",
    }
}

/// Download `url` to `dest` atomically. Returns Ok(false) on 404, Ok(true) on success.
pub fn download(http: &reqwest::blocking::Client, url: &str, dest: &Path) -> Result<bool> {
    let resp = http.get(url).send()?;
    let status = resp.status();

    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(false);
    }
    if !status.is_success() {
        return Err(CoreError::Http(format!("GET {url} returned {status}")));
    }

    if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok())
    {
        if !ct.to_ascii_lowercase().starts_with("image/") {
            return Err(CoreError::Http(format!("{url} is not an image (content-type {ct})")));
        }
    }
    if let Some(len) = resp.content_length() {
        if len > MAX_BYTES {
            return Err(CoreError::Http(format!("{url} is {len} bytes, over the {MAX_BYTES} limit")));
        }
    }

    let bytes = resp.bytes()?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(CoreError::Http(format!("{url} is over the {MAX_BYTES} byte limit")));
    }
    // An empty body is not a usable image; treat it like a miss so the next candidate is tried.
    if bytes.is_empty() {
        return Ok(false);
    }

    write_atomic(dest, &bytes)?;
    Ok(true)
}

/// Write to `<dest>.part` then rename, so a reader never sees a half-written image.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file_name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| CoreError::Invalid(format!("bad cache path {}", dest.display())))?;
    let part = dest.with_file_name(format!("{file_name}.part"));

    std::fs::write(&part, bytes)?;
    // Windows rename fails if the destination exists.
    if dest.exists() {
        let _ = std::fs::remove_file(dest);
    }
    if let Err(e) = std::fs::rename(&part, dest) {
        let _ = std::fs::remove_file(&part);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_prefers_content_type() {
        assert_eq!(extension_for("http://x/y", Some("image/png")), "png");
        assert_eq!(extension_for("http://x/y.jpg", Some("image/webp")), "webp");
        assert_eq!(extension_for("http://x/y.jpg", Some("image/png; charset=binary")), "png");
    }

    #[test]
    fn extension_falls_back_to_the_url() {
        assert_eq!(extension_for("https://cdn/apps/620/library_600x900.jpg", None), "jpg");
        assert_eq!(extension_for("https://cdn/logo.PNG", None), "png");
        assert_eq!(extension_for("https://cdn/a.webp?token=1", None), "webp");
        assert_eq!(extension_for("https://cdn/icon.ico#frag", None), "ico");
        assert_eq!(extension_for("https://cdn/no-extension", None), "jpg", "default");
        // A dot in a parent segment must not be read as the extension.
        assert_eq!(extension_for("https://cdn/v1.2/image", None), "jpg");
    }

    #[test]
    fn cache_path_is_deterministic_and_scoped() {
        let dir = Path::new("C:/cache/artwork");
        let a = cache_path(dir, "e1", ArtworkKind::Grid, "https://x/a.png");
        let b = cache_path(dir, "e1", ArtworkKind::Grid, "https://x/a.png");
        assert_eq!(a, b, "same url -> same path");

        let c = cache_path(dir, "e1", ArtworkKind::Grid, "https://x/b.png");
        assert_ne!(a, c, "different url -> different path");

        let d = cache_path(dir, "e1", ArtworkKind::Hero, "https://x/a.png");
        assert_ne!(a, d, "different kind -> different path");

        let e = cache_path(dir, "e2", ArtworkKind::Grid, "https://x/a.png");
        assert_ne!(a, e, "different entry -> different path");

        assert_eq!(a.parent().unwrap().file_name().unwrap(), "e1");
        let name = a.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("grid-") && name.ends_with(".png"), "got {name}");
    }

    #[test]
    fn override_path_marks_the_file_as_user_supplied() {
        let dir = Path::new("C:/cache/artwork");
        let p = override_path(dir, "e1", ArtworkKind::Grid, Path::new("C:/pics/mine.png"));
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("grid-user-") && name.ends_with(".png"), "got {name}");

        let q = override_path(dir, "e1", ArtworkKind::Grid, Path::new("C:/pics/other.png"));
        assert_ne!(p, q);
    }

    #[test]
    fn write_atomic_creates_dirs_replaces_and_leaves_no_part_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("e1").join("grid-abc.png");

        write_atomic(&dest, b"first").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"first");

        write_atomic(&dest, b"second").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"second", "overwrite must work");

        let leftovers: Vec<_> = std::fs::read_dir(dest.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("part"))
            .collect();
        assert!(leftovers.is_empty(), "no .part files may survive");
    }
}
