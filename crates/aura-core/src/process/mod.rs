//! Process service: launch an entry, then watch until the *game* is gone - not merely the
//! process we started. Steam launches return in ~2s while the game keeps running, so the
//! watcher combines three signals (see `watch.rs`).
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-process agent).
//! `launch_entry` flow:
//!   1. load entry (NotFound otherwise)
//!   2. `launch::spawn(&entry.launch)` -> pid/child
//!   3. `db::stats::record_launch`, emit ProcessStarted
//!   4. spawn watcher thread: `watch::wait_for_exit(...)`, then `db::stats::add_playtime`,
//!      emit ProcessExited, remove session
//!   5. return LaunchSession

pub mod launch;
pub mod tree;
pub mod watch;

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::error::Result;
use crate::events::EventSink;
use crate::model::LaunchSession;
use crate::Core;

#[derive(Debug, Clone)]
pub struct SessionHandle {
    pub session: LaunchSession,
    pub install_path: Option<String>,
}

pub struct ProcessService {
    pub sink: Arc<dyn EventSink>,
    pub sessions: Mutex<HashMap<String, SessionHandle>>,
}

impl ProcessService {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self { sink, sessions: Mutex::new(HashMap::new()) }
    }

    pub fn active_sessions(&self) -> Vec<LaunchSession> {
        self.sessions.lock().values().map(|h| h.session.clone()).collect()
    }
}

pub fn launch_entry(core: Arc<Core>, entry_id: &str) -> Result<LaunchSession> {
    let _ = (core, entry_id);
    todo!("process::launch_entry")
}
