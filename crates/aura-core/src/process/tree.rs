//! Process-tree queries on top of `sysinfo`.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-process agent).

use std::path::Path;

pub struct ProcessSnapshot {
    pub system: sysinfo::System,
}

impl ProcessSnapshot {
    /// Take a fresh snapshot of all processes (pid, parent, exe path).
    pub fn take() -> ProcessSnapshot {
        todo!("process::tree::ProcessSnapshot::take")
    }

    pub fn refresh(&mut self) {
        todo!("process::tree::ProcessSnapshot::refresh")
    }

    pub fn is_alive(&self, pid: u32) -> bool {
        let _ = pid;
        todo!("process::tree::is_alive")
    }

    /// `pid` plus every transitive child, in no particular order.
    pub fn descendants(&self, pid: u32) -> Vec<u32> {
        let _ = pid;
        todo!("process::tree::descendants")
    }

    /// Pids whose executable path starts with `dir` (case-insensitive on Windows).
    pub fn processes_under_dir(&self, dir: &Path) -> Vec<u32> {
        let _ = dir;
        todo!("process::tree::processes_under_dir")
    }
}

/// Pid that owns the current foreground window (Windows), None elsewhere.
pub fn foreground_pid() -> Option<u32> {
    todo!("process::tree::foreground_pid")
}
