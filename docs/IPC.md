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
| `get_settings` | - | `Settings` | |
| `update_settings` | `patch: Partial<Settings>` | `Settings` | Unknown keys rejected (`invalid`). Validated as a whole; failed patch applies nothing. |
| `list_entries` | `filter?: EntryFilter` | `LibraryItem[]` | Hidden excluded unless `includeHidden` |
| `get_entry` | `id` | `LibraryItem \| null` | |
| `add_manual_entry` | `input: AddManualEntryInput` | `LibraryItem` | Emits `library://updated` (`manual_add`) |
| `update_entry` | `id, patch: UpdateEntryPatch` | `LibraryItem` | name/launch -> entries; favourite/hidden -> stats |
| `remove_entry` | `id` | - | Cascades artwork + stats |
| `scan_library` | `sources?: Source[]` | `jobId: string` | Async. Default = all supported sources (Steam in V1) |
| `fetch_artwork` | `entryId, force?` | - | Async. Emits `library://artwork` per asset |
| `set_artwork_override` | `entryId, kind, path` | `Artwork` | Copies the file into the cache, sets `userOverride` |
| `launch_entry` | `id` | `LaunchSession` | Emits `process://started`, later `process://exited` |
| `active_sessions` | - | `LaunchSession[]` | |
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
