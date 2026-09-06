# Changelog

All notable changes to Aura Shell are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). IPC contract changes (renames or removals of commands,
events or fields) must be listed under **Changed** or **Removed** with both mirrors updated - see
[docs/IPC.md](docs/IPC.md#versioning).

## [Unreleased]

V1 "The Face" skeleton.

### Added

- Cargo workspace with two crates: `aura-shell` (`src-tauri/`, Tauri 2 host + IPC bridge) and
  `aura-core` (`crates/aura-core/`, native services with no Tauri or UI dependency).
- IPC contract ([docs/IPC.md](docs/IPC.md)): 21 commands and 9 events, mirrored in
  `crates/aura-core/src/model.rs` / `events.rs` and `src/bridge/types.ts`. Errors serialise as
  `{ code, message }`.
- Shell host: CLI flags (`--smoke`, `--windowed`, `--theme`, `--data-dir`), window created hidden
  and revealed on `shell_ready`, fullscreen / windowed setup, monitor selection, global exit hotkey
  (default `Ctrl+Shift+Escape`), single-instance guard, panic hook that writes `logs/crash.log` and
  drops fullscreen/topmost, minimise-on-launch / restore-on-exit hooks, `--smoke` auto-exit that
  prints `AURA_SMOKE_OK`.
- Core: filesystem layout (`Paths`, `AURA_DATA_DIR` override), validated `Settings` with
  reject-unknown-key patching, SQLite schema v1 (`entries`, `artwork`, `stats`, `collections`,
  `collection_items`, `folders`, `themes`, `settings`) with `PRAGMA user_version` migrations,
  settings repository, `EventSink` trait with Tauri / recording / null sinks, wallpaper file
  probing, Steam CDN artwork URL candidates, `CoreError` -> IPC error code mapping.
- Service scaffolding with fixed signatures: library (Steam scanner, VDF parser, manual add),
  artwork (SteamGridDB client, atomic cache), process (launch, process-tree watch), input (gilrs
  gamepad thread), theme (manifest schema, validation rules, loader).
- UI skeleton: Vite 7, React 19, TypeScript 5.9, Tailwind 4 (CSS-first), framer-motion 13,
  zustand 5, vitest 4 (jsdom). Design tokens as CSS custom properties in `src/styles/base.css`,
  bridge selection (`tauriApi` inside Tauri, `mockApi` in a browser), `onCoreEvent` / `emitLocal`,
  `assetUrl()` for local files.
- Built-in theme package `themes/aura-default` (manifest, tokens, layout, CSS, sounds, shader)
  and the theme validation script `scripts/validate-theme.mjs`.
- Documentation: PLAN, IPC, ARCHITECTURE, THEME_FORMAT, DEVELOPMENT, RISKS. GitHub Actions CI on
  `windows-latest` (typecheck, tests, theme validation, UI build, fmt, clippy, cargo test, debug
  build, `--smoke` run, artifact upload). Pull request template. MIT licence.

### Security

- Content Security Policy and Tauri capability allow-list for the main window
  (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`). The asset protocol scope is
  still `**` in V1 and must be narrowed before a public release.

[Unreleased]: https://github.com/aura-shell/aura-shell/compare/main...HEAD
