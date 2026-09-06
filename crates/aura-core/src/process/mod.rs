//! Process service: launch an entry, then watch until the *game* is gone - not merely the
//! process we started. Steam launches return in ~2s while the game keeps running, so the
//! watcher combines three signals (see `watch.rs`).
//!
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
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::db;
use crate::error::{CoreError, Result};
use crate::events::{CoreEvent, EventSink};
use crate::model::{LaunchSession, ProcessExited};
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
    let entry = db::entries::get(&core.db, entry_id)?
        .ok_or_else(|| CoreError::NotFound(format!("entry `{entry_id}`")))?;

    let spawned = launch::spawn(&entry.launch)?;
    let now = crate::now_secs();
    db::stats::record_launch(&core.db, &entry.id, now)?;

    let session = LaunchSession {
        session_id: uuid::Uuid::new_v4().to_string(),
        entry_id: entry.id.clone(),
        pid: spawned.pid,
        started_at: now,
    };

    core.process.sessions.lock().insert(
        session.session_id.clone(),
        SessionHandle { session: session.clone(), install_path: entry.install_path.clone() },
    );
    core.sink.emit(CoreEvent::ProcessStarted(session.clone()));

    let target = watch::WatchTarget {
        root_pid: spawned.pid,
        install_path: entry.install_path.as_deref().map(PathBuf::from).filter(|p| p.is_dir()),
        exe_path: launch::exe_path(&entry.launch),
        ..Default::default()
    };

    let watcher_core = core.clone();
    let session_id = session.session_id.clone();
    let watched_entry_id = entry.id.clone();
    let child = spawned.child;
    let name = entry.name.clone();

    std::thread::Builder::new()
        .name("aura-watch".into())
        .spawn(move || {
            let info = watch::wait_for_exit(target, child);
            let secs = info.duration.as_secs();
            tracing::info!("`{name}` exited after {secs}s (code {:?})", info.exit_code);

            if let Err(e) = db::stats::add_playtime(&watcher_core.db, &watched_entry_id, secs) {
                tracing::warn!("cannot record playtime for {watched_entry_id}: {e}");
            }
            watcher_core.process.sessions.lock().remove(&session_id);
            watcher_core.sink.emit(CoreEvent::ProcessExited(ProcessExited {
                session_id,
                entry_id: watched_entry_id,
                exit_code: info.exit_code,
                duration_secs: secs,
            }));
        })
        .map_err(|e| CoreError::Launch(format!("cannot spawn the watcher thread: {e}")))?;

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::RecordingSink;
    use crate::model::{Entry, EntryType, LaunchSpec, Source};
    use crate::Paths;

    fn test_core() -> (tempfile::TempDir, Arc<Core>, Arc<RecordingSink>) {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::rooted(tmp.path(), tmp.path().join("bundled-themes"));
        let sink = Arc::new(RecordingSink::default());
        let core = Core::new(paths, sink.clone()).unwrap();
        (tmp, core, sink)
    }

    #[test]
    fn launching_a_missing_entry_is_not_found() {
        let (_tmp, core, _sink) = test_core();
        assert!(matches!(launch_entry(core, "nope"), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn launch_records_stats_emits_and_tracks_the_session() {
        let (_tmp, core, sink) = test_core();

        let exe = std::env::var("COMSPEC")
            .unwrap_or_else(|_| if cfg!(windows) { r"C:\Windows\System32\cmd.exe".into() } else { "/bin/sh".into() });
        if !std::path::Path::new(&exe).is_file() {
            eprintln!("skipping: {exe} not present");
            return;
        }
        let args =
            if cfg!(windows) { vec!["/c".to_string(), "exit".to_string()] } else { vec!["-c".to_string(), "exit 0".to_string()] };

        let entry = Entry {
            id: "e1".into(),
            name: "Test".into(),
            entry_type: EntryType::App,
            source: Source::Manual,
            source_id: None,
            launch: LaunchSpec::Exe { path: exe, args, cwd: None },
            install_path: None,
            install_size: None,
            created_at: 1,
            updated_at: 1,
        };
        db::entries::upsert(&core.db, &entry).unwrap();

        let session = launch_entry(core.clone(), "e1").unwrap();
        assert_eq!(session.entry_id, "e1");
        assert!(session.pid.is_some());

        assert_eq!(core.process.active_sessions().len(), 1);
        assert_eq!(db::stats::get(&core.db, "e1").unwrap().launch_count, 1);

        let events = sink.take();
        assert!(
            events.iter().any(|e| matches!(e, CoreEvent::ProcessStarted(s) if s.entry_id == "e1")),
            "a ProcessStarted event must be emitted immediately"
        );
    }
}
