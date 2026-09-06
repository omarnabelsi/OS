//! Media service. In V1 wallpaper playback happens in the UI layer (HTML5 `<video>` / WebGL),
//! so the core only classifies files the user picks. Video decoding via libmpv is a V2 option
//! if WebView2 playback proves too costly.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperKind {
    Image,
    Video,
    Shader,
    Unknown,
}

pub fn probe(path: &Path) -> WallpaperKind {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "bmp") => WallpaperKind::Image,
        Some("mp4" | "webm" | "mkv" | "mov" | "m4v") => WallpaperKind::Video,
        Some("frag" | "glsl") => WallpaperKind::Shader,
        _ => WallpaperKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probes_by_extension() {
        assert_eq!(probe(Path::new("a.MP4")), WallpaperKind::Video);
        assert_eq!(probe(Path::new("a.webp")), WallpaperKind::Image);
        assert_eq!(probe(Path::new("a.frag")), WallpaperKind::Shader);
        assert_eq!(probe(Path::new("a.txt")), WallpaperKind::Unknown);
    }
}
