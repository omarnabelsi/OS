//! Minimal parser for Valve's text KeyValues format (`.vdf` / `.acf`).
//!
//! Handles quoted and unquoted keys/values, `\"` / `\\` escapes, `//` comments, nested `{}`
//! blocks, `#include` / `#base` directives (skipped), and is tolerant of a UTF-8 BOM and CRLF.

use crate::error::{CoreError, Result};

/// Guard against a pathological file blowing the stack.
const MAX_DEPTH: usize = 64;

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
        self.0
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
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

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Str(String),
    Open,
    Close,
}

fn tokenize(text: &str) -> Result<Vec<Token>> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // Line comment: `//` to end of line.
        if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '{' {
            out.push(Token::Open);
            i += 1;
            continue;
        }
        if c == '}' {
            out.push(Token::Close);
            i += 1;
            continue;
        }
        if c == '"' {
            i += 1;
            let mut s = String::new();
            loop {
                let Some(&ch) = chars.get(i) else {
                    return Err(CoreError::Invalid("vdf: unterminated quoted string".into()));
                };
                match ch {
                    '\\' => {
                        i += 1;
                        let Some(&esc) = chars.get(i) else {
                            return Err(CoreError::Invalid("vdf: trailing escape".into()));
                        };
                        s.push(match esc {
                            'n' => '\n',
                            't' => '\t',
                            'r' => '\r',
                            other => other, // covers \" and \\
                        });
                        i += 1;
                    }
                    '"' => {
                        i += 1;
                        break;
                    }
                    other => {
                        s.push(other);
                        i += 1;
                    }
                }
            }
            out.push(Token::Str(s));
            continue;
        }

        // Unquoted token: runs until whitespace or a structural character.
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && !matches!(chars[i], '{' | '}' | '"') {
            i += 1;
        }
        out.push(Token::Str(chars[start..i].iter().collect()));
    }

    Ok(out)
}

/// `#base "file.vdf"` / `#include "file.vdf"` pull in another file. We do not follow them;
/// skip the directive and its argument.
fn skip_directives(tokens: &[Token], i: &mut usize) {
    while let Some(Token::Str(s)) = tokens.get(*i) {
        if s.eq_ignore_ascii_case("#base") || s.eq_ignore_ascii_case("#include") {
            *i += 1;
            if matches!(tokens.get(*i), Some(Token::Str(_))) {
                *i += 1;
            }
        } else {
            break;
        }
    }
}

fn parse_obj(tokens: &[Token], i: &mut usize, depth: usize) -> Result<VdfObject> {
    if depth > MAX_DEPTH {
        return Err(CoreError::Invalid("vdf: nesting too deep".into()));
    }
    let mut obj = VdfObject::default();
    loop {
        skip_directives(tokens, i);
        match tokens.get(*i) {
            None => return Err(CoreError::Invalid("vdf: unexpected end of input".into())),
            Some(Token::Close) => {
                *i += 1;
                return Ok(obj);
            }
            Some(Token::Open) => {
                return Err(CoreError::Invalid(
                    "vdf: `{` where a key was expected".into(),
                ))
            }
            Some(Token::Str(key)) => {
                let key = key.clone();
                *i += 1;
                match tokens.get(*i) {
                    Some(Token::Open) => {
                        *i += 1;
                        let child = parse_obj(tokens, i, depth + 1)?;
                        obj.0.push((key, VdfValue::Obj(child)));
                    }
                    Some(Token::Str(v)) => {
                        let v = v.clone();
                        *i += 1;
                        obj.0.push((key, VdfValue::Str(v)));
                    }
                    _ => return Err(CoreError::Invalid(format!("vdf: key `{key}` has no value"))),
                }
            }
        }
    }
}

pub fn parse(text: &str) -> Result<Vdf> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let tokens = tokenize(text)?;
    let mut i = 0;

    skip_directives(&tokens, &mut i);

    let root_key = match tokens.get(i) {
        Some(Token::Str(s)) => {
            i += 1;
            s.clone()
        }
        _ => return Err(CoreError::Invalid("vdf: expected a root key".into())),
    };
    match tokens.get(i) {
        Some(Token::Open) => i += 1,
        _ => {
            return Err(CoreError::Invalid(
                "vdf: expected `{` after the root key".into(),
            ))
        }
    }
    let root = parse_obj(&tokens, &mut i, 1)?;
    Ok(Vdf { root_key, root })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_library_folders_file() {
        // Shaped exactly like a real libraryfolders.vdf, including tabs and CRLF.
        let text = "\"libraryfolders\"\r\n{\r\n\t\"0\"\r\n\t{\r\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\r\n\t\t\"label\"\t\t\"\"\r\n\t\t\"apps\"\r\n\t\t{\r\n\t\t\t\"620\"\t\t\"1234\"\r\n\t\t}\r\n\t}\r\n\t\"1\"\r\n\t{\r\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\r\n\t}\r\n}\r\n";
        let vdf = parse(text).unwrap();
        assert_eq!(vdf.root_key, "libraryfolders");

        let zero = vdf.root.get_obj("0").unwrap();
        assert_eq!(zero.get_str("path"), Some("C:\\Program Files (x86)\\Steam"));
        assert_eq!(zero.get_obj("apps").unwrap().get_str("620"), Some("1234"));
        assert_eq!(
            vdf.root.get_obj("1").unwrap().get_str("path"),
            Some("D:\\SteamLibrary")
        );
        assert_eq!(vdf.root.0.len(), 2);
    }

    #[test]
    fn parses_an_app_manifest() {
        let text = r#"
"AppState"
{
	"appid"		"620"
	"name"		"Portal 2"
	"StateFlags"		"4"
	"installdir"		"Portal 2"
	"SizeOnDisk"		"12345678"
	"UserConfig"
	{
		"language"		"english"
	}
}
"#;
        let vdf = parse(text).unwrap();
        assert_eq!(vdf.root_key, "AppState");
        assert_eq!(vdf.root.get_str("appid"), Some("620"));
        assert_eq!(vdf.root.get_str("SizeOnDisk"), Some("12345678"));
        // key lookup is case-insensitive, like Steam
        assert_eq!(vdf.root.get_str("stateflags"), Some("4"));
        assert!(vdf.root.get_obj("UserConfig").is_some());
        assert_eq!(
            vdf.root.get_str("UserConfig"),
            None,
            "an object is not a string"
        );
    }

    #[test]
    fn handles_bom_comments_and_escapes() {
        let text = "\u{feff}\"root\"\n{\n\t// a comment\n\t\"quote\"\t\"say \\\"hi\\\"\"\n\t\"back\"\t\"a\\\\b\"\n\t\"bare\"\tvalue\n}\n";
        let vdf = parse(text).unwrap();
        assert_eq!(vdf.root.get_str("quote"), Some("say \"hi\""));
        assert_eq!(vdf.root.get_str("back"), Some("a\\b"));
        assert_eq!(vdf.root.get_str("bare"), Some("value"));
    }

    #[test]
    fn skips_base_directives() {
        let text = "#base \"other.vdf\"\n\"root\"\n{\n\t#include \"more.vdf\"\n\t\"k\"\t\"v\"\n}\n";
        let vdf = parse(text).unwrap();
        assert_eq!(vdf.root_key, "root");
        assert_eq!(vdf.root.get_str("k"), Some("v"));
        assert_eq!(vdf.root.0.len(), 1);
    }

    #[test]
    fn keeps_repeated_keys_in_order() {
        let vdf = parse("\"r\"{\"k\" \"1\" \"k\" \"2\"}").unwrap();
        assert_eq!(vdf.root.0.len(), 2);
        assert_eq!(
            vdf.root.get_str("k"),
            Some("1"),
            "get returns the first match"
        );
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(parse("").is_err());
        assert!(parse("\"root\"").is_err(), "missing body");
        assert!(parse("\"root\" {").is_err(), "unclosed body");
        assert!(parse("\"root\" { \"k\" }").is_err(), "key without value");
        assert!(parse("\"root\" { \"unterminated").is_err());
    }

    #[test]
    fn rejects_deep_nesting() {
        let deep = format!("\"r\"{}{}", "{\"k\"".repeat(200), "}".repeat(201));
        assert!(parse(&deep).is_err());
    }
}
