// Prevents an additional console window on Windows in release. Keep the console in debug so
// `--smoke` output is visible in CI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aura_shell_lib::run()
}
