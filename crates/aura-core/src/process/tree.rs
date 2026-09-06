//! Process-tree queries on top of `sysinfo`.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use sysinfo::{Pid, ProcessesToUpdate, System};

pub struct ProcessSnapshot {
    pub system: System,
}

/// Normalise a path for comparison: one separator style, lower case on Windows.
fn norm_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// Same, but guaranteed to end in a separator so `C:\Games\A` does not match `C:\Games\AB`.
fn norm_dir(p: &Path) -> String {
    let mut s = norm_path(p);
    while s.ends_with('\\') {
        s.pop();
    }
    if s.is_empty() {
        return s;
    }
    s.push('\\');
    s
}

impl ProcessSnapshot {
    /// Take a fresh snapshot of all processes (pid, parent, exe path).
    pub fn take() -> ProcessSnapshot {
        let mut snapshot = ProcessSnapshot { system: System::new() };
        snapshot.refresh();
        snapshot
    }

    pub fn refresh(&mut self) {
        self.system.refresh_processes(ProcessesToUpdate::All, true);
    }

    pub fn is_alive(&self, pid: u32) -> bool {
        self.system.process(Pid::from_u32(pid)).is_some()
    }

    /// `pid` plus every transitive child, in no particular order.
    ///
    /// The walk starts from `pid` even when that process is already gone: on Windows a launcher
    /// commonly exits seconds after the game it started, and the children still record it as
    /// their parent. That is exactly the case this whole module exists to handle.
    pub fn descendants(&self, pid: u32) -> Vec<u32> {
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (child_pid, process) in self.system.processes() {
            if let Some(parent) = process.parent() {
                children.entry(parent.as_u32()).or_default().push(child_pid.as_u32());
            }
        }

        let mut out = Vec::new();
        let mut seen: HashSet<u32> = HashSet::new();
        let mut queue = vec![pid];
        while let Some(current) = queue.pop() {
            if !seen.insert(current) {
                continue;
            }
            out.push(current);
            if let Some(kids) = children.get(&current) {
                queue.extend(kids.iter().copied());
            }
        }
        out
    }

    /// Pids whose executable path starts with `dir` (case-insensitive on Windows).
    pub fn processes_under_dir(&self, dir: &Path) -> Vec<u32> {
        let needle = norm_dir(dir);
        if needle.is_empty() {
            return Vec::new();
        }
        self.system
            .processes()
            .iter()
            .filter_map(|(pid, process)| {
                let exe = process.exe()?;
                norm_path(exe).starts_with(&needle).then(|| pid.as_u32())
            })
            .collect()
    }

    /// Pids running exactly this executable.
    pub fn processes_matching_exe(&self, exe: &Path) -> Vec<u32> {
        let needle = norm_path(exe);
        if needle.is_empty() {
            return Vec::new();
        }
        self.system
            .processes()
            .iter()
            .filter_map(|(pid, process)| {
                let candidate = process.exe()?;
                (norm_path(candidate) == needle).then(|| pid.as_u32())
            })
            .collect()
    }
}

/// Pid that owns the current foreground window (Windows), None elsewhere.
///
/// Declared as raw FFI against `user32` rather than through the `windows` crate: these two
/// calls are stable ABI, and the handle newtypes in `windows` have changed shape across
/// releases. Nothing else in the core needs Win32.
#[cfg(windows)]
pub fn foreground_pid() -> Option<u32> {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, lpdw_process_id: *mut u32) -> u32;
    }

    // SAFETY: both calls take/return plain handles and an out-parameter we own. A null window
    // (nothing focused, or a secure desktop) is handled below.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        if GetWindowThreadProcessId(hwnd, &mut pid) == 0 || pid == 0 {
            return None;
        }
        Some(pid)
    }
}

#[cfg(not(windows))]
pub fn foreground_pid() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalisation_is_separator_and_case_insensitive_on_windows() {
        let a = norm_path(Path::new("C:/Games/Portal 2/portal2.exe"));
        let b = norm_path(Path::new(r"C:\Games\Portal 2\portal2.exe"));
        assert_eq!(a, b);
        if cfg!(windows) {
            assert_eq!(a, norm_path(Path::new(r"c:\games\PORTAL 2\Portal2.EXE")));
        }
    }

    #[test]
    fn dir_normalisation_prevents_prefix_collisions() {
        let dir = norm_dir(Path::new(r"C:\Games\A"));
        assert!(dir.ends_with('\\'));
        assert!(!norm_path(Path::new(r"C:\Games\AB\game.exe")).starts_with(&dir));
        assert!(norm_path(Path::new(r"C:\Games\A\game.exe")).starts_with(&dir));
        // A trailing separator on the input must not double up.
        assert_eq!(norm_dir(Path::new(r"C:\Games\A\")), dir);
        assert_eq!(norm_dir(Path::new("")), "");
    }

    #[test]
    fn snapshot_sees_this_process_and_its_ancestry() {
        let snapshot = ProcessSnapshot::take();
        let me = std::process::id();
        assert!(snapshot.is_alive(me), "the test process must be in its own snapshot");
        assert!(!snapshot.is_alive(u32::MAX), "a bogus pid must not be alive");

        let mine = snapshot.descendants(me);
        assert!(mine.contains(&me), "descendants always include the root pid");
    }

    #[test]
    fn descendants_finds_a_real_child() {
        // Start a child that sleeps, then confirm the tree walk sees it.
        let (exe, args) = if cfg!(windows) {
            (
                std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into()),
                vec!["/c".to_string(), "ping -n 4 127.0.0.1 >NUL".to_string()],
            )
        } else {
            ("/bin/sh".to_string(), vec!["-c".to_string(), "sleep 3".to_string()])
        };
        if !Path::new(&exe).is_file() {
            eprintln!("skipping: {exe} not present");
            return;
        }

        let mut child = std::process::Command::new(&exe)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let child_pid = child.id();

        let snapshot = ProcessSnapshot::take();
        let tree = snapshot.descendants(std::process::id());
        assert!(
            tree.contains(&child_pid),
            "the spawned child {child_pid} should appear under this process"
        );

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn processes_under_a_bogus_dir_is_empty() {
        let snapshot = ProcessSnapshot::take();
        assert!(snapshot.processes_under_dir(Path::new(r"Z:\nothing\here")).is_empty());
        assert!(snapshot.processes_under_dir(Path::new("")).is_empty());
        assert!(snapshot.processes_matching_exe(Path::new("")).is_empty());
    }

    #[test]
    fn foreground_pid_is_a_real_pid_or_none() {
        // In CI there is often no interactive desktop, so both outcomes are valid; what must
        // never happen is a nonsense value.
        if let Some(pid) = foreground_pid() {
            assert!(pid > 0);
        }
    }
}
