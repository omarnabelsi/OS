//! Wait until a launched title has really exited.
//!
//! Signals, combined with OR ("still running" if any is true):
//!   A. the root pid or any descendant is alive (`tree::descendants`)
//!   B. any process whose exe lives under `install_path` is alive
//!      (or, for entries with no install path, any process running `exe_path`)
//!   C. the foreground window belongs to one of the above pids
//!
//! Timing: wait `startup_grace` (default 15s) before trusting an all-clear, because Steam's
//! bootstrap can take several seconds before the real game process appears. Poll every
//! `poll_interval` (1s). Require `exit_debounce` (3s) of continuous all-clear before returning.
//! There is no hard cap - a game can run for hours.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::tree::{self, ProcessSnapshot};

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

/// True while any of the three signals says the title is still up.
pub fn is_running(snapshot: &ProcessSnapshot, target: &WatchTarget) -> bool {
    // A: the process we started, or anything it spawned.
    let owned: Vec<u32> = match target.root_pid {
        Some(root) => snapshot.descendants(root).into_iter().filter(|p| snapshot.is_alive(*p)).collect(),
        None => Vec::new(),
    };
    if !owned.is_empty() {
        return true;
    }

    // B: anything running out of the install directory - this is what catches Steam games,
    // whose launcher process exits long before the game does.
    if let Some(dir) = &target.install_path {
        if !snapshot.processes_under_dir(dir).is_empty() {
            return true;
        }
    }
    if let Some(exe) = &target.exe_path {
        if !snapshot.processes_matching_exe(exe).is_empty() {
            return true;
        }
    }

    // C: the user is looking at a window owned by the tree we launched.
    if let (Some(fg), Some(root)) = (tree::foreground_pid(), target.root_pid) {
        if snapshot.descendants(root).contains(&fg) && snapshot.is_alive(fg) {
            return true;
        }
    }

    false
}

/// Blocks the calling (watcher) thread until the title is gone.
pub fn wait_for_exit(target: WatchTarget, child: Option<std::process::Child>) -> ExitInfo {
    let started = Instant::now();
    let mut child = child;
    let mut exit_code: Option<i32> = None;
    let mut snapshot = ProcessSnapshot::take();
    let mut clear_since: Option<Instant> = None;

    loop {
        std::thread::sleep(target.poll_interval);

        // Reap the direct child if we own one, so we can report a real exit code.
        if let Some(process) = child.as_mut() {
            if let Ok(Some(status)) = process.try_wait() {
                exit_code = status.code();
                child = None;
            }
        }

        snapshot.refresh();

        if is_running(&snapshot, &target) {
            clear_since = None;
            continue;
        }

        // Steam's bootstrap can leave a gap where nothing of ours is running yet.
        if started.elapsed() < target.startup_grace {
            continue;
        }

        let since = *clear_since.get_or_insert_with(Instant::now);
        if since.elapsed() >= target.exit_debounce {
            break;
        }
    }

    ExitInfo { exit_code, duration: started.elapsed() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fast_target() -> WatchTarget {
        WatchTarget {
            startup_grace: Duration::from_millis(50),
            poll_interval: Duration::from_millis(20),
            exit_debounce: Duration::from_millis(60),
            ..Default::default()
        }
    }

    #[test]
    fn an_empty_target_is_never_running() {
        let snapshot = ProcessSnapshot::take();
        assert!(!is_running(&snapshot, &WatchTarget::default()));
    }

    #[test]
    fn this_process_counts_as_running() {
        let snapshot = ProcessSnapshot::take();
        let target = WatchTarget { root_pid: Some(std::process::id()), ..Default::default() };
        assert!(is_running(&snapshot, &target));
    }

    #[test]
    fn a_bogus_pid_and_dir_are_not_running() {
        let snapshot = ProcessSnapshot::take();
        let target = WatchTarget {
            root_pid: Some(u32::MAX),
            install_path: Some(PathBuf::from(r"Z:\nothing")),
            exe_path: Some(PathBuf::from(r"Z:\nothing\game.exe")),
            ..Default::default()
        };
        assert!(!is_running(&snapshot, &target));
    }

    #[test]
    fn returns_promptly_when_nothing_is_running() {
        let started = Instant::now();
        let info = wait_for_exit(
            WatchTarget { root_pid: Some(u32::MAX), ..fast_target() },
            None,
        );
        // grace (50ms) + debounce (60ms) must both elapse, but it must not hang.
        assert!(info.duration >= Duration::from_millis(100), "got {:?}", info.duration);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(info.exit_code, None);
    }

    #[test]
    fn waits_for_a_real_child_and_reports_its_exit_code() {
        let (exe, args) = if cfg!(windows) {
            (
                std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into()),
                vec!["/c".to_string(), "exit 3".to_string()],
            )
        } else {
            ("/bin/sh".to_string(), vec!["-c".to_string(), "exit 3".to_string()])
        };
        if !Path::new(&exe).is_file() {
            eprintln!("skipping: {exe} not present");
            return;
        }

        let child = std::process::Command::new(&exe)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();

        let info = wait_for_exit(WatchTarget { root_pid: Some(pid), ..fast_target() }, Some(child));
        assert_eq!(info.exit_code, Some(3));
    }
}
