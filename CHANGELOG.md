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
- Core services, implemented: SQLite repositories for entries / artwork / stats / themes
  (filtered and sorted listings, LIKE-escaped search, cascade delete, sticky `user_override`);
  a KeyValues (`.vdf` / `.acf`) parser handling quoted and bare tokens, escapes, comments,
  `#base` / `#include` and a nesting cap; the Steam scanner (registry lookup, `libraryfolders.vdf`
  including the legacy shape, `appmanifest_*.acf`, `StateFlags` and tool filtering, de-duplication
  across libraries); manual add with executable validation, `.lnk` / `.url` shell launching and
  name prettifying; the artwork pipeline (SteamGridDB with throttling, Steam CDN fallback, atomic
  downloads, content-type and size limits, one batch thread per scan); launch and process-tree
  watching (three OR-ed signals, startup grace, exit debounce); the gilrs gamepad thread with
  button/axis mapping, radial deadzone and jitter suppression; theme discovery, validation and
  loading with user-over-bundled resolution.
- UI, implemented: Vite 7, React 19, TypeScript 5.9, Tailwind 4 (CSS-first), framer-motion 13,
  zustand 5, vitest 4 (jsdom). Spatial focus engine (`src/focus`) with pure, unit-tested geometry
  and live rect reads; keyboard and gamepad bindings with auto-repeat and stick hysteresis
  (`src/input`); theme runtime mapping `tokens.json` to CSS custom properties and injecting
  `theme.css` (`src/theme`); theme sound playback (`src/sound`); WebGL2 shader wallpaper with
  image / video / colour fallbacks and focused-item colour bleed; nav bar, tile rows, hero panel,
  item menu, add-program and exit overlays, launch curtain and toasts; Home, Games, Apps and
  Settings screens, with Files and Media as explicit V2 placeholders.
- Browser mock bridge: a real fake with a sample library, localStorage settings, simulated scan
  progress and launch lifecycle, and the actual bundled theme imported through Vite - so
  `npm run dev` gives a working product with no Rust toolchain.
- Built-in theme package `themes/aura-default` (manifest, tokens, layout, CSS, shaders, SVG
  assets and five synthesised UI sounds), the theme validation script
  `scripts/validate-theme.mjs` mirroring the Rust rules, and `scripts/generate-sounds.mjs`.
- Tests: 64 frontend tests (focus geometry, input bindings, token mapping, store behaviour) plus
  Rust unit tests across the settings, database, VDF, scanner, artwork, process, input and theme
  modules.
- Documentation: README, PLAN, IPC, ARCHITECTURE, THEME_FORMAT, DEVELOPMENT, RISKS. GitHub
  Actions CI on `windows-latest` (typecheck, tests, theme validation, UI build, fmt, clippy,
  cargo test, debug build, `--smoke` run, artifact upload). Pull request template. MIT licence.

### Security

- Content Security Policy and Tauri capability allow-list for the main window
  (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`). The asset protocol scope is
  still `**` in V1 and must be narrowed before a public release.

[Unreleased]: https://github.com/aura-shell/aura-shell/compare/main...HEAD
