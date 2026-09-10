# Architecture

How the code is arranged and, more usefully, why. The layer numbering matches
[PLAN.md](PLAN.md) section 03.

## The one rule

**The UI never touches Windows.** It talks to exactly one thing: the IPC bridge. Everything that
can hang, crash, need admin rights or trip antivirus lives in Rust, behind a typed boundary that
is written down in [IPC.md](IPC.md) and mirrored in two files.

That rule is what makes the rest of the project tractable:

- community themes can ship CSS and shaders without being able to enumerate processes;
- the UI can be rewritten (or run in a plain browser) without touching shell code;
- a panic in the core does not leave a fullscreen topmost window stuck over the desktop.

## Layers

| Layer | Where | What it owns |
| --- | --- | --- |
| 5 | `themes/`, `src/theme/` | Theme packages: manifest, tokens, layout, CSS, sounds, shaders |
| 4 | `src/` | The visible product: focus engine, screens, motion, sound |
| 3 | `src-tauri/src/ipc/`, `src/bridge/` | The typed door between the two worlds |
| 2 | `crates/aura-core/` | Library, artwork, process, input, theme services. No Tauri, no UI |
| 1 | `src-tauri/src/shell_host/` | Window, monitors, hotkeys, single-instance, crash watchdog |

`aura-core` does not depend on Tauri. That is deliberate and worth protecting: it keeps the
services testable with plain `cargo test`, and it means a future non-Tauri host (a service, a CLI,
a different UI toolkit) is a rewrite of one crate rather than of everything.

## Crate and module map

```text
crates/aura-core/src/
  config/      Paths (AURA_DATA_DIR override) and the validated Settings document
  db/          SQLite: schema.sql + schema_v2.sql, migrations, one repository per table
  desktop/     The desktop surface: desktops, placed items, folders, taskbar, first-run seeding
  library/     Store scanners (Steam), the VDF parser, manual add, the scan job
  artwork/     SteamGridDB -> Steam CDN -> local cache -> artwork table
  process/     launch -> watch the process tree -> report the exit
  input/       gilrs thread, normalised gamepad events
  theme/       Discover, validate and load theme packages
  media/       Wallpaper file classification (playback is the UI's job in V1)
  files/       V2 - IFileOperation
  system/      V2 - audio, radios, power

src-tauri/src/
  shell_host/  args, window, monitors, hotkeys, watchdog
  ipc/         commands (request/response) and events (core -> UI)
  state.rs     The AppState every command receives

src/
  bridge/      The IPC contract: types, api interface, tauri impl, browser mock
  store/       zustand: library, settings, ui, desktop
  focus/       Spatial navigation: pure geometry + the React provider
  input/       Key and gamepad bindings -> navigation actions
  wm/          Window manager: pure geometry, window state, the layer that renders them
  theme/       Tokens -> CSS custom properties, theme.css injection
  sound/       Theme sound playback
  components/  Background, NavBar, Tile, Hero, Overlays, Shell
  screens/     Home, Games/Apps, Settings, and the V2 placeholders
```

## Threading

Everything slow happens off the main thread and reports back as an event.

| Thread | Started by | Lifetime |
| --- | --- | --- |
| `aura-scan` | `library::start_scan` | One scan job |
| `aura-artwork` | `artwork::start_fetch_many` | One batch of entries |
| `aura-watch` | `process::launch_entry` | Until the launched title exits |
| `aura-gamepad` | `Core::start_input` | Process lifetime, stopped by an `AtomicBool` |
| `aura-smoke` | `--smoke` | Sleeps, prints `AURA_SMOKE_OK`, exits |

A scan of a large Steam library spawns **one** artwork thread for the whole batch, not one per
game. Two hundred simultaneous HTTP requests is a good way to get rate-limited and a bad way to
use a laptop's battery.

The SQLite connection sits behind a `parking_lot::Mutex`. It is not reentrant, so a repository
function must never call another one while holding the guard - see the scoped blocks in
`db/stats.rs` for the pattern.

## Data flow: a scan

```text
UI  --scan_library-->  Core  --spawn-->  aura-scan thread
                                            |
                                            |-- ScanProgress{queued}      --> UI
                                            |-- SteamScanner::scan()
                                            |     registry -> libraryfolders.vdf
                                            |     -> appmanifest_*.acf -> DiscoveredEntry
                                            |-- ScanProgress{discovering|parsing|saving}
                                            |-- persist_discovered()
                                            |     match on (source, source_id), keep the id
                                            |-- LibraryUpdated{reason:"scan"}  --> UI
                                            |-- ScanProgress{done}            --> UI
                                            '-- start_fetch_many(missing art)
                                                  '-- ArtworkUpdated (one per asset) --> UI
```

Matching on `(source, source_id)` rather than on name is what makes a rescan idempotent: a game
that Steam renames keeps its id, and therefore keeps its playtime, favourite flag and artwork.

## Data flow: a launch

The hard part of this project, per PLAN.md section 02. A Steam game is not the process you
started - `steam://rungameid/620` hands off to the Steam client and the launcher exits in about
two seconds while the game runs for hours.

`process/watch.rs` therefore ORs three signals and only declares an exit when all are quiet:

- **A** - the root pid or any transitive descendant is alive;
- **B** - any process whose executable lives under the entry's `install_path` is alive;
- **C** - the foreground window belongs to one of those pids.

with a 15 s startup grace (Steam's bootstrap gap) and a 3 s debounce before believing an
all-clear. Signal B is the one that actually catches Steam titles.

## The UI's own architecture

**The desktop is data, and positions are cells.** `desktop/` owns the surface: which items sit
where, what a folder is, what the taskbar carries. Item positions are stored in *grid cells*, so
an arrangement made at 1080p survives a 4K monitor - `GridSettings.cell` is the only thing that
knows about pixels. Folders come in three kinds: a real path (`filesystem`, the V2 browser), a
hand-made group (`collection`), and a saved `EntryFilter` (`smart`). The last one is what the old
home rows became, which is why nothing was lost when the home screen stopped being rows.

Live window state deliberately is **not** in the database. Windows are UI state; the only
geometry persisted is `folders.window_state`, written when a window settles.

**Focus is a first-class concept, not DOM focus.** `src/focus/` keeps a registry of focusable
elements and decides what is "to the right of" the current one geometrically
(`geometry.ts`, pure and unit-tested). Rects are read live at the moment of a move, never cached:
tile rows scroll and the layout reflows, so a cached rect is stale within a frame.

Mouse hover moves the same focus rather than running a parallel highlight, so the hero panel and
the colour bleed always describe the same item however the user is driving.

**Windows are DOM elements, and focus scoping is what makes them work.** `src/wm/` follows the
same split: `geometry.ts` is pure and tested on its own, `store.ts` holds the state, and
`WindowLayer` is the only part that touches the DOM - it measures the area windows live in and
sets the focus scope. That scope is the whole reason overlapping windows do not break the focus
engine: the focused window claims `window:<id>`, and directional navigation is confined to it. A
tile in a background window is geometrically "to the right of" one in the foreground, and must
never be reachable that way. Moving *between* windows is therefore a separate, explicit action
(`nextWindow` / `prevWindow` in `src/input`), never a direction.

Window *content* comes from a registry keyed by kind, declared once in `Shell.tsx`. The window
manager knows nothing about folders or Settings, so a new kind of window is a new entry in that
object rather than a change to `src/wm/`.

**The bridge is swappable.** `src/bridge/index.ts` picks `tauriApi` or `mockApi` from
`isTauri()`. The mock is a real fake - a mutable library, localStorage settings, simulated scan
progress and launch events - so every screen can be built and demoed in a browser with
`npm run dev`. Components must never import `@tauri-apps/*` directly.

## Where to add things

| Adding | Goes in |
| --- | --- |
| A new store scanner (Epic, GOG) | `library/scanners/`, add to `scanners_for` and `supported_sources` |
| A new IPC command | `Core` method -> `ipc/commands.rs` -> `bridge/api.ts` + both impls -> `docs/IPC.md` |
| A new core event | `events.rs` `CoreEvent` + `name()` -> `bridge/types.ts` `CoreEventMap` -> `docs/IPC.md` |
| A new setting | `config/settings.rs` (+ default + validation) -> `bridge/types.ts` -> a row in `components/settings/catalog.tsx`, which both the Settings window and screen render |
| A new theme token | Every theme in `themes/`; it becomes `--group-key` automatically. Document it in THEME_FORMAT |
| A new bundled theme | A folder in `themes/`, a line in `theme:validate`, and an import in `bridge/mock.ts`; `tests/bundled_themes.rs` picks it up on its own |
| A new screen | `src/screens/`, add to `NAV_ITEMS` in `store/ui.ts` and the switch in `screens/index.tsx` |
| A new kind of window | A `WindowKind` in `wm/store.ts` + a renderer in `WINDOW_BODIES` (`Shell.tsx`); everything inside registers in the `window:<id>` focus group |
| A new navigation action | `NavAction` in `input/actions.ts`, a binding, then a case in `InputProvider` |
