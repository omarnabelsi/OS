//! SteamGridDB REST client (https://www.steamgriddb.com/api/v2).
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-artwork agent).
//! Endpoints: `/games/steam/{appid}`, `/search/autocomplete/{term}`, `/grids/game/{id}`,
//! `/heroes/game/{id}`, `/logos/game/{id}`, `/icons/game/{id}`. Auth: `Authorization: Bearer`.
//! Prefer `dimensions=600x900` for grids, `1920x620` for heroes, static images over animated.

use serde::Deserialize;

use crate::error::Result;
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

pub struct SgdbClient<'a> {
    pub http: &'a reqwest::blocking::Client,
    pub api_key: &'a str,
}

impl<'a> SgdbClient<'a> {
    pub fn new(http: &'a reqwest::blocking::Client, api_key: &'a str) -> Self {
        Self { http, api_key }
    }

    /// SteamGridDB game id for a Steam appid.
    pub fn game_id_by_steam_appid(&self, appid: &str) -> Result<Option<u64>> {
        let _ = appid;
        todo!("steamgriddb::game_id_by_steam_appid")
    }

    /// Best-match SteamGridDB game id for a free-text name (manual entries).
    pub fn search_game(&self, name: &str) -> Result<Option<u64>> {
        let _ = name;
        todo!("steamgriddb::search_game")
    }

    /// Images of one kind for a game, best first (filters nsfw/humor, prefers static).
    pub fn images(&self, game_id: u64, kind: ArtworkKind) -> Result<Vec<SgdbImage>> {
        let _ = (game_id, kind);
        todo!("steamgriddb::images")
    }
}
