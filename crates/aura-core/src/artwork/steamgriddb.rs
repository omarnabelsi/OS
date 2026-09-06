//! SteamGridDB REST client (https://www.steamgriddb.com/api/v2).
//!
//! Endpoints: `/games/steam/{appid}`, `/search/autocomplete/{term}`, `/grids/game/{id}`,
//! `/heroes/game/{id}`, `/logos/game/{id}`, `/icons/game/{id}`. Auth: `Authorization: Bearer`.
//! Grids prefer `600x900`, heroes `1920x620`; static images rank above animated ones.

use serde::Deserialize;

use crate::error::{CoreError, Result};
use crate::model::ArtworkKind;

pub const BASE_URL: &str = "https://www.steamgriddb.com/api/v2";

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct SgdbImage {
    pub id: u64,
    pub url: String,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub style: Option<String>,
    pub mime: Option<String>,
    #[serde(default)]
    pub nsfw: bool,
    #[serde(default)]
    pub humor: bool,
}

impl SgdbImage {
    fn is_animated(&self) -> bool {
        self.mime.as_deref().map(|m| m.eq_ignore_ascii_case("image/gif")).unwrap_or(false)
            || self.url.to_ascii_lowercase().ends_with(".gif")
    }
}

/// `{ "success": true, "data": ... }` - the envelope every endpoint uses.
#[derive(Debug, Deserialize)]
struct SgdbResponse<T> {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Option<T>,
    #[serde(default)]
    errors: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct SgdbGame {
    id: u64,
}

/// Preferred dimensions per kind, and the API path segment.
fn endpoint(kind: ArtworkKind) -> (&'static str, Option<&'static str>) {
    match kind {
        ArtworkKind::Grid => ("grids", Some("600x900")),
        ArtworkKind::Hero => ("heroes", Some("1920x620")),
        ArtworkKind::Logo => ("logos", None),
        ArtworkKind::Icon => ("icons", None),
    }
}

pub struct SgdbClient<'a> {
    pub http: &'a reqwest::blocking::Client,
    pub api_key: &'a str,
}

impl<'a> SgdbClient<'a> {
    pub fn new(http: &'a reqwest::blocking::Client, api_key: &'a str) -> Self {
        Self { http, api_key }
    }

    fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Option<T>> {
        let url = format!("{BASE_URL}{path}");
        let resp = self
            .http
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", self.api_key))
            .send()?;

        let status = resp.status();
        // A game with no artwork of this kind is a normal outcome, not an error.
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(CoreError::Http("SteamGridDB rejected the API key".into()));
        }
        if !status.is_success() {
            return Err(CoreError::Http(format!("SteamGridDB {path} returned {status}")));
        }

        let parsed: SgdbResponse<T> = resp.json()?;
        if !parsed.success {
            let why = parsed.errors.unwrap_or_default().join(", ");
            tracing::debug!("SteamGridDB {path} was unsuccessful: {why}");
            return Ok(None);
        }
        Ok(parsed.data)
    }

    /// SteamGridDB game id for a Steam appid.
    pub fn game_id_by_steam_appid(&self, appid: &str) -> Result<Option<u64>> {
        let game: Option<SgdbGame> = self.get(&format!("/games/steam/{appid}"))?;
        Ok(game.map(|g| g.id))
    }

    /// Best-match SteamGridDB game id for a free-text name (manual entries).
    pub fn search_game(&self, name: &str) -> Result<Option<u64>> {
        let term = urlencode(name.trim());
        if term.is_empty() {
            return Ok(None);
        }
        let games: Option<Vec<SgdbGame>> = self.get(&format!("/search/autocomplete/{term}"))?;
        // The API returns best match first.
        Ok(games.and_then(|g| g.first().map(|g| g.id)))
    }

    /// Images of one kind for a game, best first (filters nsfw/humor, prefers static).
    pub fn images(&self, game_id: u64, kind: ArtworkKind) -> Result<Vec<SgdbImage>> {
        let (segment, dimensions) = endpoint(kind);

        // Ask for the ideal size first; fall back to any size when that comes back empty.
        let mut images: Vec<SgdbImage> = Vec::new();
        if let Some(dim) = dimensions {
            let path = format!("/{segment}/game/{game_id}?dimensions={dim}");
            images = self.get::<Vec<SgdbImage>>(&path)?.unwrap_or_default();
        }
        if images.is_empty() {
            let path = format!("/{segment}/game/{game_id}");
            images = self.get::<Vec<SgdbImage>>(&path)?.unwrap_or_default();
        }

        images.retain(|i| !i.nsfw && !i.humor && !i.url.is_empty());
        // Static images first; everything else keeps the API's own ranking.
        images.sort_by_key(|i| i.is_animated());
        Ok(images)
    }
}

/// Percent-encode a search term. Only the handful of characters that actually break a path
/// segment - `reqwest` handles the rest.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_match_the_api() {
        assert_eq!(endpoint(ArtworkKind::Grid), ("grids", Some("600x900")));
        assert_eq!(endpoint(ArtworkKind::Hero), ("heroes", Some("1920x620")));
        assert_eq!(endpoint(ArtworkKind::Logo), ("logos", None));
        assert_eq!(endpoint(ArtworkKind::Icon), ("icons", None));
    }

    #[test]
    fn encodes_search_terms() {
        assert_eq!(urlencode("Portal 2"), "Portal%202");
        assert_eq!(urlencode("hades"), "hades");
        assert_eq!(urlencode("a/b?c"), "a%2Fb%3Fc");
        assert_eq!(urlencode(""), "");
    }

    fn image(id: u64, url: &str, mime: &str, nsfw: bool, humor: bool) -> SgdbImage {
        SgdbImage {
            id,
            url: url.into(),
            thumb: None,
            width: Some(600),
            height: Some(900),
            style: None,
            mime: Some(mime.into()),
            nsfw,
            humor,
        }
    }

    #[test]
    fn detects_animated_images() {
        assert!(image(1, "a.png", "image/gif", false, false).is_animated());
        assert!(image(1, "a.GIF", "image/png", false, false).is_animated());
        assert!(!image(1, "a.png", "image/png", false, false).is_animated());
    }

    #[test]
    fn response_envelope_parses() {
        let ok: SgdbResponse<SgdbGame> =
            serde_json::from_str(r#"{"success":true,"data":{"id":1234,"name":"Portal 2"}}"#)
                .unwrap();
        assert!(ok.success);
        assert_eq!(ok.data.unwrap().id, 1234);

        let err: SgdbResponse<Vec<SgdbImage>> =
            serde_json::from_str(r#"{"success":false,"errors":["Game not found"]}"#).unwrap();
        assert!(!err.success);
        assert!(err.data.is_none());
        assert_eq!(err.errors.unwrap(), vec!["Game not found".to_string()]);
    }

    #[test]
    fn image_list_parses_with_missing_optional_fields() {
        let images: Vec<SgdbImage> =
            serde_json::from_str(r#"[{"id":1,"url":"https://x/a.png"}]"#).unwrap();
        assert_eq!(images[0].url, "https://x/a.png");
        assert!(!images[0].nsfw);
        assert!(images[0].width.is_none());
    }
}
