use aura_core::MonitorInfo;
use tauri::{AppHandle, Manager};

pub fn list(app: &AppHandle) -> tauri::Result<Vec<MonitorInfo>> {
    let Some(win) = app.get_webview_window(super::window::MAIN) else { return Ok(vec![]) };
    let primary = win.primary_monitor()?;
    let primary_pos = primary.as_ref().map(|m| *m.position());
    Ok(win
        .available_monitors()?
        .into_iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned(),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
            primary: primary_pos.map(|p| p == *m.position()).unwrap_or(false),
        })
        .collect())
}
