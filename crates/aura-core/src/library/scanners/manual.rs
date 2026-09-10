//! Manual add: the user browses to an `.exe` (or `.lnk`, `.url`, `.bat`) and we build an entry.
//!
//! Rules: path must exist and be a file; `.lnk` is stored as `LaunchSpec::Shell{target}` so
//! Windows resolves it; `.url` likewise; everything else is `LaunchSpec::Exe` with
//! `cwd = parent dir`. Name defaults to a prettified file stem ("my_game-x64" -> "My Game").

use std::path::Path;

use crate::error::{CoreError, Result};
use crate::model::{AddManualEntryInput, DiscoveredEntry, EntryType, LaunchSpec, Source};

/// Build-artefact noise dropped from a generated name.
const NOISE: [&str; 14] = [
    "x64", "x86", "win64", "win32", "win", "amd64", "64bit", "32bit", "shipping", "release",
    "debug", "final", "retail", "launcher",
];

pub fn discover(input: &AddManualEntryInput) -> Result<DiscoveredEntry> {
    let path = Path::new(input.path.trim());
    if input.path.trim().is_empty() {
        return Err(CoreError::Invalid("path must not be empty".into()));
    }
    if !path.exists() {
        return Err(CoreError::NotFound(format!(
            "`{}` does not exist",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(CoreError::Invalid(format!(
            "`{}` is not a file",
            path.display()
        )));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());

    let launch = match ext.as_str() {
        // Let Windows resolve shortcuts and internet links rather than second-guessing them.
        "lnk" | "url" => LaunchSpec::Shell {
            target: path.display().to_string(),
        },
        _ => LaunchSpec::Exe {
            path: path.display().to_string(),
            args: input.args.clone(),
            cwd: parent.map(|p| p.display().to_string()),
        },
    };

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| prettify_name(stem));

    Ok(DiscoveredEntry {
        name,
        entry_type: input.entry_type.unwrap_or(EntryType::App),
        source: Source::Manual,
        source_id: None,
        launch,
        install_path: parent.map(|p| p.display().to_string()),
        install_size: std::fs::metadata(path).ok().map(|m| m.len()),
    })
}

/// "elden_ring-x64.exe" -> "Elden Ring". Public for tests.
pub fn prettify_name(file_stem: &str) -> String {
    let spaced: String = file_stem
        .chars()
        .map(|c| {
            if c == '_' || c == '-' || c == '.' {
                ' '
            } else {
                c
            }
        })
        .collect();

    let words: Vec<String> = spaced
        .split_whitespace()
        .filter(|w| !NOISE.contains(&w.to_lowercase().as_str()))
        .map(|w| {
            // Leave anything with an uppercase letter alone so acronyms ("FTL") and
            // CamelCase ("OpenRCT2") survive; only title-case all-lowercase words.
            if w.chars().any(|c| c.is_uppercase()) {
                w.to_string()
            } else {
                let mut chars = w.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect();

    let joined = words.join(" ");
    if joined.trim().is_empty() {
        file_stem.trim().to_string()
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettifies_common_shapes() {
        assert_eq!(prettify_name("elden_ring-x64"), "Elden Ring");
        assert_eq!(prettify_name("my_game-x64"), "My Game");
        assert_eq!(prettify_name("hades"), "Hades");
        assert_eq!(prettify_name("Portal 2"), "Portal 2");
        assert_eq!(prettify_name("FTL"), "FTL", "acronyms are left alone");
        assert_eq!(
            prettify_name("OpenRCT2"),
            "OpenRCT2",
            "CamelCase is left alone"
        );
        assert_eq!(prettify_name("game-win64-shipping"), "Game");
        assert_eq!(
            prettify_name("x64"),
            "x64",
            "an all-noise name falls back to the stem"
        );
        assert_eq!(prettify_name(""), "");
    }

    fn input(path: &str) -> AddManualEntryInput {
        AddManualEntryInput {
            name: None,
            path: path.into(),
            args: vec![],
            entry_type: None,
        }
    }

    #[test]
    fn discovers_an_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("cool_game-x64.exe");
        std::fs::write(&exe, b"MZ").unwrap();

        let e = discover(&input(&exe.display().to_string())).unwrap();
        assert_eq!(e.name, "Cool Game");
        assert_eq!(e.source, Source::Manual);
        assert_eq!(e.entry_type, EntryType::App, "defaults to App");
        assert_eq!(e.source_id, None);
        assert_eq!(e.install_size, Some(2));
        match e.launch {
            LaunchSpec::Exe { path, args, cwd } => {
                assert_eq!(path, exe.display().to_string());
                assert!(args.is_empty());
                assert_eq!(cwd, Some(tmp.path().display().to_string()));
            }
            other => panic!("expected Exe, got {other:?}"),
        }
    }

    #[test]
    fn shortcuts_use_the_shell_launcher() {
        let tmp = tempfile::tempdir().unwrap();
        for ext in ["lnk", "url"] {
            let file = tmp.path().join(format!("thing.{ext}"));
            std::fs::write(&file, b"x").unwrap();
            let e = discover(&input(&file.display().to_string())).unwrap();
            assert_eq!(
                e.launch,
                LaunchSpec::Shell {
                    target: file.display().to_string()
                },
                ".{ext} must be launched through the shell"
            );
        }
    }

    #[test]
    fn explicit_name_type_and_args_win() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("raw_name.exe");
        std::fs::write(&exe, b"MZ").unwrap();

        let e = discover(&AddManualEntryInput {
            name: Some("  My Title  ".into()),
            path: exe.display().to_string(),
            args: vec!["--fullscreen".into()],
            entry_type: Some(EntryType::Game),
        })
        .unwrap();

        assert_eq!(e.name, "My Title");
        assert_eq!(e.entry_type, EntryType::Game);
        match e.launch {
            LaunchSpec::Exe { args, .. } => assert_eq!(args, vec!["--fullscreen".to_string()]),
            other => panic!("expected Exe, got {other:?}"),
        }
    }

    #[test]
    fn rejects_missing_paths_and_directories() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(matches!(
            discover(&input(&tmp.path().join("nope.exe").display().to_string())),
            Err(CoreError::NotFound(_))
        ));
        assert!(matches!(
            discover(&input(&tmp.path().display().to_string())),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            discover(&input("   ")),
            Err(CoreError::Invalid(_))
        ));
    }
}
