//! Minimal parser for Valve's text KeyValues format (`.vdf` / `.acf`).
//!
//! STATUS: stub - signatures are fixed, body to be implemented (owner: core-library agent).
//! Requirements: quoted and unquoted keys/values, `\"` and `\\` escapes, `//` comments,
//! nested `{}` blocks, `#include`/`#base` ignored, tolerant of BOM and CRLF. Must parse real
//! `libraryfolders.vdf` and `appmanifest_*.acf` files; add fixtures under `tests/fixtures/`.

use crate::error::Result;

#[derive(Debug, Clone, PartialEq)]
pub enum VdfValue {
    Str(String),
    Obj(VdfObject),
}

/// Ordered key/value pairs. Steam files can repeat keys, so this is not a map.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VdfObject(pub Vec<(String, VdfValue)>);

#[derive(Debug, Clone, PartialEq)]
pub struct Vdf {
    pub root_key: String,
    pub root: VdfObject,
}

impl VdfObject {
    /// First value with this key (case-insensitive, like Steam).
    pub fn get(&self, key: &str) -> Option<&VdfValue> {
        self.0.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
    }
    pub fn get_str(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            VdfValue::Str(s) => Some(s.as_str()),
            VdfValue::Obj(_) => None,
        }
    }
    pub fn get_obj(&self, key: &str) -> Option<&VdfObject> {
        match self.get(key)? {
            VdfValue::Obj(o) => Some(o),
            VdfValue::Str(_) => None,
        }
    }
    pub fn iter(&self) -> impl Iterator<Item = (&str, &VdfValue)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v))
    }
}

pub fn parse(text: &str) -> Result<Vdf> {
    let _ = text;
    todo!("library::vdf::parse")
}
