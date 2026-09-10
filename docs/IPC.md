# IPC bridge contract (Layer 3)

The UI talks to the native core through Tauri commands (request/response) and events
(core -> UI stream). This document is the single source of truth; the two code mirrors are:

- Rust: `crates/aura-core/src/model.rs`, `crates/aura-core/src/events.rs`, `src-tauri/src/ipc/commands.rs`
- TypeScript: `src/bridge/types.ts`, `src/bridge/api.ts`

Serialisation rules: struct fields are **camelCase**, enum variants are **snake_case**, tagged
enums use a `kind` discriminator. Errors are `{ code, message }` (`CoreError` / `IpcError`).
Command arguments are camelCase on the JS side (`entryId`) and snake_case in Rust (`entry_id`).

## Commands

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `get_app_info` | - | `AppInfo` | version, dirs, mode (`overlay` in V1), smoke flag |
| `get_settings` | - | `Settings` | No audio settings beyond `soundsEnabled` / `soundVolume` - see the note below |
| `update_settings` | `patch: Partial<Settings>` | `Settings` | Unknown keys rejected (`invalid`). Validated as a whole; failed patch applies nothing. |

**Two rules the desktop commands rely on.**

*Positions are grid cells, not pixels.* `DesktopItem.x/y/width/height` count cells, so an
arrangement made at 1080p survives a 4K monitor. `GridSettings.cell` converts, and can change
without touching a single stored item.

*Live window geometry never crosses this boundary.* Windows are UI state (zustand). The only
persisted geometry is `Folder.windowState`, written when a window settles so reopening a folder
restores where it was left - never on a drag frame. For the same reason `list_taskbar_items`
returns only pinned and structural items: whether something is *running* is derived in the UI
from open windows plus `active_sessions`, so it cannot go stale after a crash.

**There is no music in Aura Shell, and the contract enforces it.** `Settings` has no `musicVolume`
(`update_settings` rejects it as an unknown key), and `WallpaperSetting`'s `video` variant is
`{ kind, path }` with no `muted` flag, so nothing crossing this boundary - a setting, a saved
document or a community theme's `layout.background` - can ask the shell to play audio. A leftover
`muted` key inside a `wallpaper` value is ignored rather than rejected, so old installs keep
working. The only audio the app produces is the five short interface sounds a theme supplies
(`move`, `select`, `back`, `launch`, `error`).
| `list_entries` | `filter?: EntryFilter` | `LibraryItem[]` | Hidden excluded unless `includeHidden` |
| `get_entry` | `id` | `LibraryItem \| null` | |
| `add_manual_entry` | `input: AddManualEntryInput` | `LibraryItem` | Emits `library://updated` (`manual_add`), then `library://artwork` once the executable's icon is extracted. `input.type` decides Games vs Apps and defaults to `app` |
| `update_entry` | `id, patch: UpdateEntryPatch` | `LibraryItem` | name/launch -> entries; favourite/hidden -> stats |
| `remove_entry` | `id` | - | Cascades artwork + stats |
| `scan_library` | `sources?: Source[]` | `jobId: string` | Async. Default = all supported sources (Steam in V1) |
| `fetch_artwork` | `entryId, force?` | - | Async. Emits `library://artwork` per asset |
| `set_artwork_override` | `entryId, kind, path` | `Artwork` | Copies the file into the cache, sets `userOverride` |
| `launch_entry` | `id` | `LaunchSession` | Emits `process://started`, later `process://exited` |
| `active_sessions` | - | `LaunchSession[]` | |
| `list_desktops` | - | `Desktop[]` | Ordered by `sortOrder`. Plural from the start (workspaces) |
| `get_desktop` | `id` | `Desktop \| null` | |
| `create_desktop` | `name` | `Desktop` | |
| `update_desktop` | `desktop: Desktop` | `Desktop` | Whole-object write; name, wallpaper override, grid settings |
| `delete_desktop` | `id` | - | Refuses the last one (`invalid`) - the UI has no state for "no surface" |
| `list_desktop_items` | `desktopId` | `DesktopItem[]` | Reading order |
| `add_desktop_item` | `input: NewDesktopItem` | `DesktopItem` | |
| `update_desktop_item` | `id, patch: DesktopItemPatch` | `DesktopItem` | Absent fields unchanged, so a drop sends `{x, y}`. Spans clamp to >= 1 |
| `remove_desktop_item` | `id` | - | |
| `list_folders` | - | `Folder[]` | |
| `get_folder` | `id` | `Folder \| null` | |
| `create_folder` | `input: NewFolder` | `Folder` | `filesystem` needs a path; virtual kinds get a `smart:`/`collection:` locator |
| `update_folder` | `id, patch: FolderPatch` | `Folder` | The folder editor. An absent field is unchanged and an explicit `null` clears it (label, colour, icon, cover, shape, filter, collection, window state); the locator never moves |
| `delete_folder` | `id` | - | Prunes desktop items pointing at it |
| `folder_contents` | `id` | `LibraryItem[]` | smart -> filter results; collection -> members; filesystem -> `[]` until V2 |
| `list_taskbar_items` | - | `TaskbarItem[]` | Pinned and structural only - see the note below |
| `pin_to_taskbar` | `targetId` | `TaskbarItem` | Idempotent; pinning twice returns the same item |
| `unpin_from_taskbar` | `targetId` | - | |
| `reorder_taskbar` | `ids: string[]` | - | Rewrites `sortOrder` in one pass |
| `get_system_status` | - | `SystemStatus` | Battery and charging from `GetSystemPowerStatus`. Never fails: a machine with no battery reports `hasBattery: false`, not an error. No clock - the UI uses `new Date()` |
| `list_themes` | - | `ThemeInfo[]` | bundled + user, user wins on id clash |
| `get_theme` | `id?` | `ThemeBundle` | `id` omitted = active theme |
| `set_active_theme` | `id` | `ThemeBundle` | Persists `themeId`, emits `theme://changed` |
| `get_monitors` | - | `MonitorInfo[]` | |
| `set_fullscreen` | `fullscreen: bool` | - | |
| `shell_ready` | - | - | UI calls after first paint; host shows the hidden window |
| `exit_shell` | - | - | Stops input thread, exits process |
| `minimize_shell` | - | - | |

`pickFile(kind)` on the JS `AuraApi` is not a command; it wraps `@tauri-apps/plugin-dialog`.

## Events (core -> UI)

| Name | Payload | When |
| --- | --- | --- |
| `library://scan-progress` | `ScanProgress` | Each stage of a scan; final one has `done: true` |
| `library://updated` | `LibraryUpdated` | Entries added/changed/removed (`reason`) |
| `library://artwork` | `ArtworkUpdated` | One asset saved to the cache |
| `desktop://updated` | `DesktopUpdated` | The surface changed - an item moved, a folder was edited, the taskbar was pinned. Coarse: reload the arrangement, do not branch on `reason` |
| `process://started` | `LaunchSession` | Immediately after spawn. Host minimises the window if `hideShellOnLaunch` |
| `process://exited` | `ProcessExited` | Process tree gone (debounced). Host restores the window |
| `input://gamepad` | `GamepadEvent` | Button/axis changes, connect/disconnect |
| `theme://changed` | `{ themeId }` | After `set_active_theme` |
| `shell://toast` | `Toast` | Non-fatal warnings from background jobs |
| `shell://hotkey` | `{ action: 'exit' }` | Emitted by the host just before exiting on the global hotkey |

## Asset access

Artwork and theme files are absolute paths. The UI converts them with `assetUrl()`
(`convertFileSrc` under Tauri). The asset protocol scope is configured in
`src-tauri/tauri.conf.json`; V1 allows `**` and should be narrowed before public release.

## Versioning

Additive changes (new optional fields, new commands, new events) are fine. Renames and removals
need a bump of `SCHEMA_VERSION`-style coordination in both mirrors and a note in `CHANGELOG.md`.
