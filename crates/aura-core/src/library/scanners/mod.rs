//! Store scanners. Each scanner discovers installed titles for one source. V1 ships Steam only;
//! Epic / GOG / EA / UWP are V2 and get their own file here when they land.

pub mod manual;
pub mod steam;

use crate::error::Result;
use crate::model::{DiscoveredEntry, Source};

pub trait Scanner: Send {
    fn source(&self) -> Source;
    /// Blocking. Called on the scan thread.
    fn scan(&self) -> Result<Vec<DiscoveredEntry>>;
}

/// Build the scanners for the requested sources, skipping any whose store is not installed.
pub fn scanners_for(sources: &[Source]) -> Vec<Box<dyn Scanner>> {
    let mut out: Vec<Box<dyn Scanner>> = Vec::new();
    // Steam is the only store with a scanner today; Epic, Gog, Ea and Uwp are V2.
    for s in sources {
        if *s == Source::Steam {
            if let Some(sc) = steam::SteamScanner::detect() {
                out.push(Box::new(sc));
            }
        }
    }
    out
}

/// Every source that has a scanner implementation today.
pub fn supported_sources() -> Vec<Source> {
    vec![Source::Steam]
}
