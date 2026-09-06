//! Turn a `LaunchSpec` into a running process.
//!
//! STATUS: stub - signatures are fixed, bodies to be implemented (owner: core-process agent).
//!   - `Exe`   : `std::process::Command` with cwd; on Windows set CREATE_NEW_PROCESS_GROUP is
//!               NOT needed; do inherit no stdio (`Stdio::null()`).
//!   - `Uri`   : `ShellExecuteW(NULL, "open", uri, NULL, NULL, SW_SHOWNORMAL)` - returns no pid.
//!   - `Shell` : `explorer.exe <target>` for `shell:AppsFolder\...`, or ShellExecuteW on the
//!               `.lnk` path. explorer.exe exits immediately; pid is None.

use crate::error::Result;
use crate::model::LaunchSpec;

pub struct Spawned {
    /// Direct child pid when we own the process, None for protocol / shell launches.
    pub pid: Option<u32>,
    pub child: Option<std::process::Child>,
}

pub fn spawn(spec: &LaunchSpec) -> Result<Spawned> {
    let _ = spec;
    todo!("process::launch::spawn")
}
