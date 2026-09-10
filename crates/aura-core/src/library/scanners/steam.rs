//! Steam scanner.
//!
//! Algorithm:
//!   1. `detect()`: Steam root from `HKCU\Software\Valve\Steam\SteamPath`, falling back to
//!      `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath`, then the default install location.
//!   2. `library_folders(root)`: parse `<root>/steamapps/libraryfolders.vdf`; each numbered
//!      child has a `path`. Always include `<root>` itself. De-duplicate.
//!   3. For each library `<lib>/steamapps/appmanifest_*.acf`: `parse_app_manifest`.
//!   4. Skip non-games (see `is_tool`) and any manifest whose `StateFlags` lacks bit 4
//!      (fully installed).
//!   5. launch = `steam://rungameid/<appid>`, install_path = `<lib>/steamapps/common/<installdir>`,
//!      install_size = `SizeOnDisk`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::Scanner;
use crate::error::Result;
use crate::library::vdf::{self, VdfValue};
use crate::model::{DiscoveredEntry, EntryType, LaunchSpec, Source};

/// Steamworks Common Redistributables - present in almost every library, never a game.
pub const REDIST_APPID: &str = "228980";

pub struct SteamScanner {
    pub root: PathBuf,
}

impl SteamScanner {
    /// Locate the Steam installation, if any.
    pub fn detect() -> Option<SteamScanner> {
        find_steam_root().map(|root| SteamScanner { root })
    }

    pub fn with_root(root: PathBuf) -> SteamScanner {
        SteamScanner { root }
    }
}

impl Scanner for SteamScanner {
    fn source(&self) -> Source {
        Source::Steam
    }

    fn scan(&self) -> Result<Vec<DiscoveredEntry>> {
        scan_root(&self.root)
    }
}

/// A path is a plausible Steam root when it has a `steamapps` directory.
fn looks_like_steam(path: &Path) -> bool {
    path.join("steamapps").is_dir()
}

fn default_locations() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(base) = std::env::var_os(var) {
                candidates.push(PathBuf::from(base).join("Steam"));
            }
        }
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    } else if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".steam").join("steam"));
        candidates.push(home.join(".local").join("share").join("Steam"));
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("Steam"),
        );
    }
    candidates.into_iter().find(|p| looks_like_steam(p))
}

/// Registry / default-location lookup. Returns None when Steam is not installed.
#[cfg(windows)]
pub fn find_steam_root() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(r"Software\Valve\Steam") {
        if let Ok(p) = key.get_value::<String, _>("SteamPath") {
            let path = PathBuf::from(p.replace('/', r"\"));
            if looks_like_steam(&path) {
                return Some(path);
            }
        }
    }

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for sub in [r"SOFTWARE\WOW6432Node\Valve\Steam", r"SOFTWARE\Valve\Steam"] {
        if let Ok(key) = hklm.open_subkey(sub) {
            if let Ok(p) = key.get_value::<String, _>("InstallPath") {
                let path = PathBuf::from(p);
                if looks_like_steam(&path) {
                    return Some(path);
                }
            }
        }
    }

    default_locations()
}

#[cfg(not(windows))]
pub fn find_steam_root() -> Option<PathBuf> {
    default_locations()
}

/// Comparison key for de-duplicating library paths (case-insensitive on Windows).
fn norm_key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.trim_end_matches('\\').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn add_library(out: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    if !looks_like_steam(&path) {
        return;
    }
    if seen.insert(norm_key(&path)) {
        out.push(path);
    }
}

/// All library folders (including the root) that currently exist on disk.
pub fn library_folders(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    add_library(&mut out, &mut seen, root.to_path_buf());

    let vdf_path = root.join("steamapps").join("libraryfolders.vdf");
    let Ok(text) = std::fs::read_to_string(&vdf_path) else {
        return Ok(out);
    };
    let parsed = match vdf::parse(&text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("steam: cannot parse {}: {e}", vdf_path.display());
            return Ok(out);
        }
    };

    for (key, value) in parsed.root.iter() {
        // Only numbered children are libraries; skip metadata keys like "contentstatsid".
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        match value {
            // Modern format: "0" { "path" "D:\\SteamLibrary" ... }
            VdfValue::Obj(o) => {
                if let Some(p) = o.get_str("path") {
                    add_library(&mut out, &mut seen, PathBuf::from(p));
                }
            }
            // Legacy format: "1" "D:\\SteamLibrary"
            VdfValue::Str(p) => add_library(&mut out, &mut seen, PathBuf::from(p)),
        }
    }

    Ok(out)
}

/// Parse one `appmanifest_<appid>.acf`. Returns None for non-game / incomplete manifests.
pub fn parse_app_manifest(
    steamapps_dir: &Path,
    manifest_path: &Path,
) -> Result<Option<DiscoveredEntry>> {
    let text = std::fs::read_to_string(manifest_path)?;
    let parsed = match vdf::parse(&text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("steam: cannot parse {}: {e}", manifest_path.display());
            return Ok(None);
        }
    };
    let app = &parsed.root;

    let Some(appid) = app
        .get_str("appid")
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };
    let Some(name) = app.get_str("name").map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };

    // Bit 4 = fully installed. Anything else is downloading, updating or a leftover shortcut.
    let flags: u64 = app
        .get_str("StateFlags")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    if flags & 4 == 0 {
        return Ok(None);
    }
    if is_tool(appid, name) {
        return Ok(None);
    }

    let installdir = app
        .get_str("installdir")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(name);
    let install_path = steamapps_dir.join("common").join(installdir);
    let install_size = app
        .get_str("SizeOnDisk")
        .and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|v| *v > 0);

    Ok(Some(DiscoveredEntry {
        name: name.to_string(),
        entry_type: EntryType::Game,
        source: Source::Steam,
        source_id: Some(appid.to_string()),
        launch: LaunchSpec::Uri {
            uri: format!("steam://rungameid/{appid}"),
        },
        install_path: Some(install_path.display().to_string()),
        install_size,
    }))
}

/// Full scan of one Steam root. Pure function of the filesystem - testable with fixtures.
pub fn scan_root(root: &Path) -> Result<Vec<DiscoveredEntry>> {
    let mut out: Vec<DiscoveredEntry> = Vec::new();
    let mut seen_appids: HashSet<String> = HashSet::new();

    for lib in library_folders(root)? {
        let steamapps = lib.join("steamapps");
        let Ok(dir) = std::fs::read_dir(&steamapps) else {
            continue;
        };
        for item in dir.flatten() {
            let path = item.path();
            let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let lower = fname.to_ascii_lowercase();
            if !lower.starts_with("appmanifest_") || !lower.ends_with(".acf") {
                continue;
            }
            match parse_app_manifest(&steamapps, &path) {
                Ok(Some(entry)) => {
                    // The same game can appear in two libraries; keep the first.
                    if let Some(id) = &entry.source_id {
                        if !seen_appids.insert(id.clone()) {
                            continue;
                        }
                    }
                    out.push(entry);
                }
                Ok(None) => {}
                Err(e) => tracing::warn!("steam: skipping {}: {e}", path.display()),
            }
        }
    }

    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

/// Whether an appid/name pair is a tool rather than a game.
pub fn is_tool(appid: &str, name: &str) -> bool {
    if appid.trim() == REDIST_APPID {
        return true;
    }
    let lower = name.to_lowercase();
    // Steam's Proton tools are always "Proton" followed by a separator ("Proton 9.0",
    // "Proton Experimental", "Proton - Hotfix"). A bare `starts_with("proton")` also matched
    // "Protonwar", a real game, and hid it from the library - so require a word boundary.
    let is_proton = lower
        .strip_prefix("proton")
        .is_some_and(|rest| !rest.starts_with(|c: char| c.is_alphanumeric()));
    is_proton
        || lower.contains("redistributable")
        || lower.contains("steam linux runtime")
        || lower.contains("steamworks common")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(appid: &str, name: &str, flags: &str, installdir: &str, size: &str) -> String {
        format!(
            "\"AppState\"\n{{\n\t\"appid\"\t\"{appid}\"\n\t\"name\"\t\"{name}\"\n\t\"StateFlags\"\t\"{flags}\"\n\t\"installdir\"\t\"{installdir}\"\n\t\"SizeOnDisk\"\t\"{size}\"\n}}\n"
        )
    }

    /// Build a fake Steam root: `<root>/steamapps/` plus an optional second library.
    fn fake_steam(dir: &Path, extra_lib: Option<&Path>) -> PathBuf {
        let root = dir.join("Steam");
        std::fs::create_dir_all(root.join("steamapps").join("common")).unwrap();

        let mut vdf = String::from("\"libraryfolders\"\n{\n");
        vdf.push_str(&format!(
            "\t\"0\"\n\t{{\n\t\t\"path\"\t\"{}\"\n\t}}\n",
            root.display().to_string().replace('\\', "\\\\")
        ));
        if let Some(lib) = extra_lib {
            std::fs::create_dir_all(lib.join("steamapps").join("common")).unwrap();
            vdf.push_str(&format!(
                "\t\"1\"\n\t{{\n\t\t\"path\"\t\"{}\"\n\t}}\n",
                lib.display().to_string().replace('\\', "\\\\")
            ));
        }
        vdf.push_str("\t\"contentstatsid\"\t\"12345\"\n}\n");
        std::fs::write(root.join("steamapps").join("libraryfolders.vdf"), vdf).unwrap();
        root
    }

    #[test]
    fn tool_detection() {
        assert!(is_tool(REDIST_APPID, "Steamworks Common Redistributables"));
        assert!(is_tool("1", "Proton 9.0"));
        assert!(is_tool("2", "Steam Linux Runtime - Soldier"));
        assert!(is_tool("3", "Microsoft Visual C++ Redistributable"));
        assert!(!is_tool("620", "Portal 2"));
        assert!(
            !is_tool("620", "Protonwar"),
            "substring match must not swallow real games"
        );
        // The separator, not just the prefix, is what marks a Proton tool.
        assert!(is_tool("4", "Proton"), "the bare name is the tool itself");
        assert!(is_tool("5", "Proton - Experimental"));
        assert!(is_tool("6", "Proton Hotfix"));
        assert!(
            !is_tool("7", "Protonwar 2"),
            "a game whose first word merely begins with proton"
        );
    }

    #[test]
    fn parses_a_manifest_into_an_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let steamapps = tmp.path().join("steamapps");
        std::fs::create_dir_all(&steamapps).unwrap();
        let path = steamapps.join("appmanifest_620.acf");
        std::fs::write(
            &path,
            manifest("620", "Portal 2", "4", "Portal 2", "12345678"),
        )
        .unwrap();

        let e = parse_app_manifest(&steamapps, &path).unwrap().unwrap();
        assert_eq!(e.name, "Portal 2");
        assert_eq!(e.source, Source::Steam);
        assert_eq!(e.entry_type, EntryType::Game);
        assert_eq!(e.source_id.as_deref(), Some("620"));
        assert_eq!(
            e.launch,
            LaunchSpec::Uri {
                uri: "steam://rungameid/620".into()
            }
        );
        assert_eq!(e.install_size, Some(12_345_678));

        // Compare by components so the assertion holds on either path separator.
        let install = PathBuf::from(e.install_path.expect("install path"));
        assert_eq!(install.file_name().unwrap(), "Portal 2");
        assert_eq!(install.parent().unwrap().file_name().unwrap(), "common");
    }

    #[test]
    fn skips_incomplete_and_tool_manifests() {
        let tmp = tempfile::tempdir().unwrap();
        let steamapps = tmp.path().join("steamapps");
        std::fs::create_dir_all(&steamapps).unwrap();

        // StateFlags 1026 = downloading, bit 4 not set
        let downloading = steamapps.join("appmanifest_1.acf");
        std::fs::write(
            &downloading,
            manifest("1", "Half Downloaded", "1026", "hd", "1"),
        )
        .unwrap();
        assert!(parse_app_manifest(&steamapps, &downloading)
            .unwrap()
            .is_none());

        let redist = steamapps.join("appmanifest_228980.acf");
        std::fs::write(
            &redist,
            manifest(
                REDIST_APPID,
                "Steamworks Common Redistributables",
                "4",
                "r",
                "1",
            ),
        )
        .unwrap();
        assert!(parse_app_manifest(&steamapps, &redist).unwrap().is_none());

        let nameless = steamapps.join("appmanifest_2.acf");
        std::fs::write(&nameless, manifest("2", "", "4", "x", "1")).unwrap();
        assert!(parse_app_manifest(&steamapps, &nameless).unwrap().is_none());

        let garbage = steamapps.join("appmanifest_3.acf");
        std::fs::write(&garbage, "not a vdf file {{{").unwrap();
        assert!(parse_app_manifest(&steamapps, &garbage).unwrap().is_none());
    }

    #[test]
    fn library_folders_includes_root_and_extras() {
        let tmp = tempfile::tempdir().unwrap();
        let extra = tmp.path().join("D_SteamLibrary");
        let root = fake_steam(tmp.path(), Some(&extra));

        let libs = library_folders(&root).unwrap();
        assert_eq!(libs.len(), 2, "root + one extra, root listed first");
        assert_eq!(norm_key(&libs[0]), norm_key(&root));
        assert_eq!(norm_key(&libs[1]), norm_key(&extra));
    }

    #[test]
    fn library_folders_survives_a_missing_or_broken_vdf() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Steam");
        std::fs::create_dir_all(root.join("steamapps")).unwrap();
        assert_eq!(
            library_folders(&root).unwrap().len(),
            1,
            "no vdf -> just the root"
        );

        std::fs::write(
            root.join("steamapps").join("libraryfolders.vdf"),
            "}}} broken",
        )
        .unwrap();
        assert_eq!(
            library_folders(&root).unwrap().len(),
            1,
            "broken vdf -> just the root"
        );
    }

    #[test]
    fn scan_root_walks_every_library_and_sorts() {
        let tmp = tempfile::tempdir().unwrap();
        let extra = tmp.path().join("D_SteamLibrary");
        let root = fake_steam(tmp.path(), Some(&extra));

        let a = root.join("steamapps");
        std::fs::write(
            a.join("appmanifest_620.acf"),
            manifest("620", "Portal 2", "4", "Portal 2", "10"),
        )
        .unwrap();
        std::fs::write(
            a.join("appmanifest_228980.acf"),
            manifest(
                REDIST_APPID,
                "Steamworks Common Redistributables",
                "4",
                "r",
                "1",
            ),
        )
        .unwrap();
        std::fs::write(a.join("not-a-manifest.txt"), "ignored").unwrap();

        let b = extra.join("steamapps");
        std::fs::write(
            b.join("appmanifest_504230.acf"),
            manifest("504230", "Celeste", "4", "Celeste", "20"),
        )
        .unwrap();
        // Duplicate of Portal 2 in the second library - must be counted once.
        std::fs::write(
            b.join("appmanifest_620.acf"),
            manifest("620", "Portal 2", "4", "Portal 2", "10"),
        )
        .unwrap();

        let found = scan_root(&root).unwrap();
        assert_eq!(
            found.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["Celeste", "Portal 2"]
        );
    }

    #[test]
    fn scan_root_of_a_nonexistent_dir_is_empty() {
        let found = scan_root(Path::new("Z:/definitely/not/steam")).unwrap();
        assert!(found.is_empty());
    }
}
