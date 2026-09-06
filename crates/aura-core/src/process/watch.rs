//! Wait until a launched title has really exited.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-process agent).
//!
//! Signals, combined with OR ("still running" if any is true):
//!   A. the root pid or any descendant is alive (`tree::descendants`)
//!   B. any process whose exe lives under `install_path` is alive (`tree::processes_under_dir`)
//!   C. (optional) the foreground window belongs to one of the above pids
//!
//! Timing: wait `startup_grace` (default 15s) before trusting an all-clear, because Steam's
//! bootstrap can take several seconds before the real game process appears. Poll every
//! `poll_interval` (1s). Require `exit_debounce` (3s) of continuous all-clear before returning.
//! Hard cap nothing - a game can run for hours.

use std::path::PathBuf;
use std::time::Duration;

pub struct WatchTarget {
    pub root_pid: Option<u32>,
    pub install_path: Option<PathBuf>,
    pub exe_path: Option<PathBuf>,
    pub startup_grace: Duration,
    pub poll_interval: Duration,
    pub exit_debounce: Duration,
}

impl Default for WatchTarget {
    fn default() -> Self {
        Self {
            root_pid: None,
            install_path: None,
            exe_path: None,
            startup_grace: Duration::from_secs(15),
            poll_interval: Duration::from_secs(1),
            exit_debounce: Duration::from_secs(3),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExitInfo {
    pub exit_code: Option<i32>,
    pub duration: Duration,
}

/// Blocks the calling (watcher) thread until the title is gone.
pub fn wait_for_exit(target: WatchTarget, child: Option<std::process::Child>) -> ExitInfo {
    let _ = (target, child);
    todo!("process::watch::wait_for_exit")
}
