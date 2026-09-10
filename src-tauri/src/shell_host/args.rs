//! Command-line flags. Kept dependency-free on purpose.
//!
//! ```text
//! aura-shell [--smoke [SECS]] [--windowed] [--theme ID] [--data-dir PATH]
//! ```
//! - `--smoke`: windowed, never topmost, auto-exit after SECS (default 8). Prints
//!   `AURA_SMOKE_OK` on a clean exit. Used by CI and `npm run smoke`.
//! - `--windowed`: start windowed regardless of settings (a fraction of the monitor's size,
//!   see `shell_host::window::windowed_size`).
//! - `--theme`: override the active theme id for this run (not persisted).
//! - `--data-dir`: override the data directory (sets `AURA_DATA_DIR`).

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Args {
    pub smoke: bool,
    pub smoke_secs: u64,
    pub windowed: bool,
    pub theme: Option<String>,
    pub data_dir: Option<String>,
}

impl Args {
    pub fn parse<I: IntoIterator<Item = String>>(argv: I) -> Args {
        let mut args = Args { smoke_secs: 8, ..Default::default() };
        let mut it = argv.into_iter().peekable();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--smoke" => {
                    args.smoke = true;
                    if let Some(n) = it.peek().and_then(|s| s.parse::<u64>().ok()) {
                        args.smoke_secs = n;
                        it.next();
                    }
                }
                "--windowed" => args.windowed = true,
                "--theme" => args.theme = it.next(),
                "--data-dir" => args.data_dir = it.next(),
                other => log::warn!("ignoring unknown argument `{other}`"),
            }
        }
        args
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Args {
        Args::parse(s.split_whitespace().map(String::from))
    }

    #[test]
    fn parses_flags() {
        assert!(!p("").smoke);
        let a = p("--smoke 3 --windowed --theme neon --data-dir C:/x");
        assert!(a.smoke && a.windowed);
        assert_eq!(a.smoke_secs, 3);
        assert_eq!(a.theme.as_deref(), Some("neon"));
        assert_eq!(a.data_dir.as_deref(), Some("C:/x"));
        assert_eq!(p("--smoke").smoke_secs, 8);
    }
}
