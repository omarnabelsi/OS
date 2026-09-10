//! Turn a `LaunchSpec` into a running process.
//!
//! - `Exe`: `std::process::Command` with cwd and null stdio, so the game never inherits our
//!   handles and never blocks on a pipe nobody reads.
//! - `Uri`: handed to the shell. On Windows that is `explorer.exe <uri>`, which resolves
//!   `steam://`, `com.epicgames.launcher://` and friends exactly like ShellExecuteW does -
//!   without an `unsafe` FFI call whose handle types shift between `windows` crate releases.
//!   explorer exits immediately, so there is no pid to own.
//! - `Shell`: the same path, which covers `shell:AppsFolder\Package!App` and `.lnk` files.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::error::{CoreError, Result};
use crate::model::LaunchSpec;

pub struct Spawned {
    /// Direct child pid when we own the process, None for protocol / shell launches.
    pub pid: Option<u32>,
    pub child: Option<std::process::Child>,
}

/// The executable a spec points at, when it names one. Used by the watcher as a fallback
/// signal for entries with no install path.
pub fn exe_path(spec: &LaunchSpec) -> Option<PathBuf> {
    match spec {
        LaunchSpec::Exe { path, .. } => Some(PathBuf::from(path)),
        LaunchSpec::Uri { .. } | LaunchSpec::Shell { .. } => None,
    }
}

/// Hand a URI or shell target to the OS shell.
fn shell_open(target: &str) -> Result<()> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("explorer.exe");
        c.arg(target);
        c
    } else if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg(target);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(target);
        c
    };

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // explorer.exe returns a non-zero exit code even on success, so the status is ignored;
    // only a failure to start the helper at all is an error.
    match cmd.spawn() {
        Ok(_child) => Ok(()),
        Err(e) => Err(CoreError::Launch(format!("cannot open `{target}`: {e}"))),
    }
}

pub fn spawn(spec: &LaunchSpec) -> Result<Spawned> {
    match spec {
        LaunchSpec::Exe { path, args, cwd } => {
            let exe = Path::new(path);
            if !exe.is_file() {
                return Err(CoreError::NotFound(format!("`{path}` does not exist")));
            }

            let mut cmd = Command::new(exe);
            cmd.args(args);

            // Prefer the declared cwd, else the executable's own folder: plenty of games
            // resolve their data relative to the working directory.
            let dir = cwd
                .as_deref()
                .map(PathBuf::from)
                .filter(|p| p.is_dir())
                .or_else(|| exe.parent().filter(|p| p.is_dir()).map(Path::to_path_buf));
            if let Some(dir) = dir {
                cmd.current_dir(dir);
            }

            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());

            let child = cmd
                .spawn()
                .map_err(|e| CoreError::Launch(format!("cannot start `{path}`: {e}")))?;
            Ok(Spawned {
                pid: Some(child.id()),
                child: Some(child),
            })
        }

        LaunchSpec::Uri { uri } => {
            if uri.trim().is_empty() {
                return Err(CoreError::Invalid("launch uri must not be empty".into()));
            }
            shell_open(uri)?;
            Ok(Spawned {
                pid: None,
                child: None,
            })
        }

        LaunchSpec::Shell { target } => {
            if target.trim().is_empty() {
                return Err(CoreError::Invalid("shell target must not be empty".into()));
            }
            shell_open(target)?;
            Ok(Spawned {
                pid: None,
                child: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_path_only_for_exe_specs() {
        let exe = LaunchSpec::Exe {
            path: "C:/g/a.exe".into(),
            args: vec![],
            cwd: None,
        };
        assert_eq!(exe_path(&exe), Some(PathBuf::from("C:/g/a.exe")));
        assert_eq!(
            exe_path(&LaunchSpec::Uri {
                uri: "steam://rungameid/1".into()
            }),
            None
        );
        assert_eq!(
            exe_path(&LaunchSpec::Shell {
                target: "shell:AppsFolder".into()
            }),
            None
        );
    }

    #[test]
    fn missing_executable_is_a_clear_error() {
        let spec = LaunchSpec::Exe {
            path: "Z:/definitely/missing.exe".into(),
            args: vec![],
            cwd: None,
        };
        assert!(matches!(spawn(&spec), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn empty_targets_are_rejected() {
        assert!(matches!(
            spawn(&LaunchSpec::Uri { uri: "  ".into() }),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            spawn(&LaunchSpec::Shell {
                target: String::new()
            }),
            Err(CoreError::Invalid(_))
        ));
    }

    /// Spawns a real, harmless process to prove the Exe path works end to end.
    #[test]
    fn spawns_a_real_process_and_reports_its_pid() {
        let (exe, args) = if cfg!(windows) {
            (
                which_windows_exe(),
                vec!["/c".to_string(), "exit".to_string()],
            )
        } else {
            (
                "/bin/sh".to_string(),
                vec!["-c".to_string(), "exit 0".to_string()],
            )
        };
        if !Path::new(&exe).is_file() {
            eprintln!("skipping: {exe} not present");
            return;
        }

        let spec = LaunchSpec::Exe {
            path: exe,
            args,
            cwd: None,
        };
        let mut spawned = spawn(&spec).unwrap();
        assert!(spawned.pid.is_some());
        let status = spawned.child.as_mut().unwrap().wait().unwrap();
        assert!(status.success());
    }

    fn which_windows_exe() -> String {
        std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".to_string())
    }
}
