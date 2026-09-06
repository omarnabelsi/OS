//! Steam's public image CDN - no API key required. Used for every Steam entry as the baseline.

use crate::model::ArtworkKind;

pub const CDN: &str = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/// Candidate URLs for an asset kind, best first. Callers try each until one downloads.
pub fn candidates(appid: &str, kind: ArtworkKind) -> Vec<String> {
    let base = format!("{CDN}/{appid}");
    match kind {
        ArtworkKind::Grid => vec![
            format!("{base}/library_600x900_2x.jpg"),
            format!("{base}/library_600x900.jpg"),
            format!("{base}/header.jpg"),
        ],
        ArtworkKind::Hero => vec![
            format!("{base}/library_hero.jpg"),
            format!("{base}/page_bg_generated_v6b.jpg"),
            format!("{base}/header.jpg"),
        ],
        ArtworkKind::Logo => vec![format!("{base}/logo.png")],
        ArtworkKind::Icon => vec![format!("{base}/capsule_231x87.jpg")],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_prefers_2x_portrait() {
        let c = candidates("620", ArtworkKind::Grid);
        assert!(c[0].ends_with("/620/library_600x900_2x.jpg"));
        assert_eq!(c.len(), 3);
    }
}
