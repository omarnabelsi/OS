# Changelog

All notable changes to Aura Shell are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). IPC contract changes (renames or removals of commands,
events or fields) must be listed under **Changed** or **Removed** with both mirrors updated - see
[docs/IPC.md](docs/IPC.md#versioning).

## [Unreleased]

V1 "The Face" skeleton.

### Added - the design system

- **Type foundation.** `aura-default` bundles Manrope (six `woff2` subsets, 73 KB, OFL). Ten type
  roles in `src/styles/type.css`, sized in `rem` so UI Scale moves them and weighted from
  `font.weight.*` so a theme re-pitches the whole hierarchy without touching a component. Theme
  tokens now nest three levels deep, and `theme.css` may reference the theme's own files with a
  relative `url(...)`, validated in both validators and rewritten at injection time.
- **Elevation ladder and blur budget.** Five levels consumed through a `<Surface level>` primitive.
  At most three surfaces run a live `backdrop-filter` at once; the rest fall back to a flat fill,
  and a machine that cannot hold the frame rate falls back to one shared 2 fps snapshot of the
  field. A `blurMode` setting (`auto` / `full` / `off`) overrides the probe, and a theme's
  `blur.surface: 0` overrides everything.
- **Aurora background field.** Four layers - two drifts on 68 s and 104 s so the pair does not
  repeat for nearly an hour, a vignette, and browser-generated `feTurbulence` grain that never
  takes a click. It is the ground under every wallpaper, so a failed shader leaves the design
  rather than a hole; the WebGL shaders remain selectable by name.
- **The folder.** `<Folder>` with three shapes, live tint, cover art, label and meta, and the full
  rest / hover / focus / press machine - including peers dimming to 68% while one folder is
  focused. Shape geometry (`height`, `radius`, `offsetTop`, `tab`) is declared per shape in a
  theme's `layout.json`, so a fourth shape is theme data rather than a branch in a component.
- **The desktop surface.** A free-placement seven-column grid with a 259 x 240 cell, positions
  stored in cells so an arrangement made at 1080p survives a 4K monitor, a clock widget and a
  now-playing widget placed on the same grid as everything else, and a debug snap-grid overlay on
  `Ctrl+Shift+G`.
- **The taskbar.** A detached floating pill: 76px tall, 28px corners, 28px off the screen edge,
  56px icon plates with a 44px hit-area floor, distinct focused and running indicators, and
  tooltips after a 400ms dwell or immediately on focus. One component and one rule set serve all
  four edges - moving the bar is a change of anchor, not a second layout.

- **The window shell.** 1300 x 790 by default, level e3 glass with a top sheen and an inset
  highlight composed onto e3's own shadow, and the desktop behind it blurred 7px and dimmed while
  a window holds focus - so a folder window reads as the folder having grown, not as a dialog
  landing on it. It opens over 420ms from the point the folder was activated. The 64px title bar
  carries a back chevron, a divider, the folder's icon in accent, a title and a subtitle, with
  three 40px controls on the right. Content is a chip row - exactly one chip filled with the
  accent - a section header that never sits over artwork, and the tile grid with its own hover,
  focus and press states. Focus scoping is the real work: each window owns the engine's scope
  while it is focused, so directional movement cannot reach a background window, and moving
  between windows stays a separate action.

- **The folder editor.** 1260 x 748, split 520px and then the rest, with a live preview beside the
  controls. The preview is the real `<Folder>` component at the size it has on the desktop - not a
  second renderer that could drift from it - handed `interactive={false}` so a picture of a folder
  is not a focus stop. Shape choices are miniatures built from the theme's own geometry, the tint
  swatches come from a theme's new `palette` token group, and the footer is Cancel and Save:
  changes write through live, so Cancel means "put back what was there" and Save means "stop
  reverting it". A chosen cover goes through `set_folder_cover`, which copies the image into the
  artwork cache rather than storing a path into the user's own files.

### Fixed - navigation

- **Directional movement could not walk a wide row.** Drifting off-axis was priced at 30px of
  forward progress, which is right at tile scale and wrong at bar scale: on a 1300px window title
  bar the control 1114px away along the bar cost more than a chip 31px below it, so pressing right
  from the back chevron dropped into the content and the window controls could only be reached
  from the far side of the bar. Alignment is now a tier rather than a price - anything still on
  your row or column beats anything that is not, and distance only decides within a tier.

- **The D-pad could not get back to the desktop from the taskbar.** Down from the bottom folder
  reached the taskbar's Home button, but Up from there picked whatever was best aligned above the
  *button* - the nav bar - and skipped every folder. A move that crosses from one focus group into
  another now remembers where it came from, and the opposite press retraces it exactly
  (`src/focus/returnPath.ts`). Inside a group the geometry still decides, and "back" is forgotten
  as soon as focus moves on from where the crossing landed.
- **Focus showed when nobody had asked for it, and hover could never be seen.** Mouse and pad
  share one focus, and hovering moves it - so every hover drew the full focus treatment, the
  folder's hover state and the taskbar's 400ms tooltip dwell never appeared, and on boot the
  engine's own placement lit up the first folder and dimmed every other one. The engine now
  records what placed focus (`nav`, `pointer` or `auto`), and `useFocusable` returns `visible`,
  true only for D-pad or keyboard focus - `:focus-visible`'s rule. The desktop is at rest until the
  pad is used; its first press reveals where focus is instead of moving past it; a press with
  nowhere to go still reveals an unseen focus; and closing a window with the pad keeps the ring.
- **The first-run desktop did not fit its own reference display.** Four folders seeded in a column
  needed four rows, and 1080p has three, so the last one was pulled out of place on the very first
  launch. They are seeded two by two, and a test holds the whole first-run desktop to a 7 x 3 grid
  with nothing overlapping.

### Changed - IPC contract

- `Settings` gains `blurMode` (`auto` | `full` | `off`).
- `SystemStatus` gains `epochMs` and `utcOffsetMinutes`. The clock now comes from the host rather
  than `new Date()` - as an *anchor*, not a tick: the UI advances it from a monotonic clock
  between the status polls it was already making and re-anchors on each one, so the shell shows
  the time and zone Windows reports without a round trip per second. Both mirrors and
  [docs/IPC.md](docs/IPC.md) updated.

### Added

- Cargo workspace with two crates: `aura-shell` (`src-tauri/`, Tauri 2 host + IPC bridge) and
  `aura-core` (`crates/aura-core/`, native services with no Tauri or UI dependency).
- IPC contract ([docs/IPC.md](docs/IPC.md)): 21 commands and 9 events, mirrored in
  `crates/aura-core/src/model.rs` / `events.rs` and `src/bridge/types.ts`. Errors serialise as
  `{ code, message }`.
- Shell host: CLI flags (`--smoke`, `--windowed`, `--theme`, `--data-dir`), window created hidden
  and revealed on `shell_ready`, fullscreen / windowed setup, monitor selection, global exit hotkey
  (default `Ctrl+Alt+Q`), single-instance guard, panic hook that writes `logs/crash.log` and
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

### Fixed

- The window is sized from the monitor instead of a hard-coded 1280x720. `tauri.conf.json` starts
  fullscreen at native resolution, `shell_host::window` re-asserts fullscreen in `reveal` (a hidden
  WebView2 window does not always take the resize), and the windowed size is 80% of the target
  monitor, clamped between 960x540 and 2560x1440.
- Keyboard navigation no longer rides the OS auto-repeat rate. Held keys go through the same
  `createRepeater` cadence as the gamepad (400ms, then 110ms), the focus engine scrolls instantly
  rather than smoothly so `move()` never measures a rect mid-animation, and focus recovery
  remembers the last focused rect so a tile leaving the registry no longer jumps focus back to the
  first tile.
- Manually added programs get artwork: the icon inside the executable is extracted on Windows
  (`artwork::exe_icon`, following `.lnk` shortcuts to their target via `IShellLinkW`) and written
  as both `icon` and a letterboxed 2:3 `grid`, so a hand-added app has a real tile with no
  SteamGridDB key. Runs after the network lookups and only fills empty slots.
- "Add a program" from the Games screen files the entry under Games. The overlay is told which
  screen opened it (`ui.openAddEntry`) and carries a Games/Apps picker; it no longer hard-codes
  `type: 'app'`.
- Launching a title no longer looks like the shell quitting: `hide_for_launch` leaves fullscreen
  before minimising, and `restore_after_launch` re-asserts the remembered fullscreen state rather
  than trusting `is_fullscreen()` to have survived the round trip.
- Text no longer clips or overlaps. The hero band has a measured minimum height (a `ResizeObserver`
  on `.aura-hero-body` publishing `--hero-content-height`) as well as a floored `clamp()`, and
  every `line-height` in `shell.css` is stated rather than left to a font-dependent `normal` -
  the hero title moves from 1.02 to 1.12. `--font-ui` also names "Segoe UI Variable Text"
  correctly (the old `'Segoe UI Variable'` matched no installed family) and leads with `Inter`
  ready for a bundled `@font-face`.

### Added (desktop shell, phase 1 of 8: data model, migration, IPC, mock)

The product is repositioning from "console launcher" to **customisable Windows-inspired desktop
shell** - a surface with freely placed folders, windows and a taskbar, all theme-driven. See
[docs/PLAN.md](docs/PLAN.md) section 01 for the revised framing and competitive set (Rainmeter,
StartAllBack, ExplorerPatcher, Nexus/ObjectDock). This is the foundation; the surface, window
manager, taskbar, folder editor and windowed Settings follow.

- **Schema v2**, additive only, with a **backup before migration** (closes the gap
  [docs/RISKS.md](docs/RISKS.md) R8 flagged): `aura.db` is WAL-checkpointed and copied to
  `aura.db.bak-v<n>` before any upgrade. New tables `desktops`, `desktop_items`, `taskbar_items`;
  new `folders` columns `shape`, `kind`, `collection_id`, `filter`, `window_state`. Nothing is
  dropped or rewritten, so entries, artwork and playtime are untouched. The column step is
  **replayable** - `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`, so a crash between the ALTERs
  and the `user_version` bump would otherwise brick the install on every later start.
- **Concept model** in `model.rs` + `types.ts`: `Desktop`, `GridSettings`, `DesktopItem`,
  `Folder` (three kinds - filesystem, collection, smart), `FolderWindowState`, `TaskbarItem`.
  Item positions are **grid cells, not pixels**, so an arrangement made at 1080p survives a 4K
  monitor. Virtual folders keep `folders.path` as their unique locator via a scheme prefix
  (`smart:all-games`, `collection:<uuid>`) rather than the table being rebuilt.
- **`desktop/` service** and three repositories (`db/desktops.rs`, `db/folders.rs`,
  `db/taskbar.rs`), plus **19 IPC commands** and the `desktop://updated` event, mirrored across
  all four places and documented in [docs/IPC.md](docs/IPC.md).
- **Seeded first run** ([docs/RISKS.md](docs/RISKS.md) R15): today's home rows become four smart
  folders - Games, Apps, Favourites, Recently played - laid down the first column, with a taskbar
  carrying the launcher, the system area and the most-played titles pinned. Nothing is lost;
  everything becomes movable and editable.
- **Mock bridge extended in the same commit**, so the desktop, windows and taskbar can be built
  entirely in a browser with `npm run dev`. 13 new tests pin the mock to the same semantics the
  Rust repositories are tested for.
- New risks recorded: R11 spatial navigation across overlapping windows (the scope mechanism is
  the answer, not directional movement), R12 compositing cost, R13 scope creep into a real shell,
  R14 which Windows behaviours are honoured and which are deliberately not, R15 discoverability.

### Added (desktop shell, phase 2 of 8: the desktop surface)

- **Home is a desktop.** `DesktopSurface` replaces the stack of tile rows: folders and shortcuts
  sit on the wallpaper where the user put them. The hero panel is gone with the launcher framing
  it belonged to (`Hero.tsx` is kept for the folder window in a later phase).
- **Drag to reposition, snapped to the grid.** Pointer-based rather than HTML5 drag, so the
  gesture can be previewed and themed; pointer capture keeps a fast drag tracking. A press only
  becomes a drag past a 4px threshold, and the click that follows a drag does not open the item.
  One `update_desktop_item` per gesture, on drop - never per frame.
- **Positions persist** in grid cells, so an arrangement made at 1080p survives a 4K monitor.
  `DesktopSurface` owns the only cell-to-pixel conversion in the codebase.
- **`resolveDrop` never stacks two icons in one cell** - the lower one would be unreachable. It
  spirals to the nearest free cell, preferring an orthogonal neighbour over a diagonal, clamps to
  the surface, and leaves an item where it was if every cell is taken. 14 unit tests.
- **Theme extensions, phase-2 subset**: `layout.json` gains `desktop.grid`, `desktop.defaultItems`
  and `folderShapes`; `tokens.json` gains the `desktop.*` group. Folder shapes are used as CSS
  **masks** so the folder's colour tints them, which is what lets a theme ship one flat
  silhouette instead of one file per colour.
- **layout.json is now validated.** It is handed to the UI verbatim and, with `folderShapes`,
  references assets for the first time - a path-traversal surface the moment a theme is shared
  (RISKS.md R5). Entries that are absolute, contain `..`, are missing or are not kebab-case are
  dropped with a warning by the loader and reported as errors by `validate-theme.mjs`. Both
  validators updated together, as the format requires.
- **Focus engine generalised.** Re-homing focus off the nav bar was spelled `group !== 'content'`,
  which silently stopped working the moment a second primary group existed - focus stuck on the
  nav bar and never reached the desktop. It now tests against a chrome-group set, which also
  covers the `taskbar` and `window:*` groups arriving next.

The desktop deliberately claims **no focus scope yet**. Scoping is the answer to overlapping
windows (R11), but it also seals the pool off: scoping today would make the nav bar unreachable
by D-pad, because the action that moves focus between scopes arrives with the window manager.

### Added (desktop shell, phase 3 of 8: the window manager)

- **Windows.** `src/wm` opens, focuses, moves, resizes, minimises, maximises, snaps, stacks and
  cycles them. Every window is a DOM element inside the one webview, never a real OS window
  (brief 4.3): one webview keeps theming, focus, motion and z-order ours and sidesteps per-window
  DPI and decoration problems on Windows. Folders on the desktop now open into one.
- **Geometry is pure and tested first.** `geometry.ts` has no React and no store in it -
  `clampSize`, `constrainToDesktop`, `snapRegionFor`, `rectForSnap`, `resizeRect`, `cascadeRect`,
  covered by 24 unit tests. A window can never be dragged somewhere it cannot be dragged back
  from: at least 96px of it stays inside the desktop on every edge.
- **Snapping**, armed on the pointer rather than the window, because dragging *to* an edge is the
  gesture: left/right halves, four quarter corners, and top to maximise. A live preview shows the
  landing rectangle and nothing is applied until the drop. There is deliberately **no bottom
  edge** region - it resolves to nothing in Windows either, and the taskbar lands there in phase
  5, where a snap fired by reaching for the taskbar would be unavoidable.
- **Focus scoping, the answer to R11.** The focused window sets `window:<id>` as the focus
  engine's scope, so directional navigation is confined to it. Without this a tile in a
  background window is geometrically "to the right of" one in the foreground and would take
  focus. Moving *between* windows is a separate explicit action, never a directional move:
  `Ctrl+Tab` / `Ctrl+Shift+Tab` / `F6`, or the shoulder triggers on a pad. Clearing focus returns
  the desktop and nav bar to the pool.
- **Chords now reach the input layer.** `actionForKey` bailed out on any modifier, so `Ctrl+Tab`
  could never be bound. It now matches an explicit chord allow-list before that bail-out, which
  keeps every other modifier combination reserved for the OS.
- **Minimise looks like a move, not a dismissal** - the window flies to where its taskbar button
  will be and shrinks into it, so the user is shown where to get it back; closing simply goes.
  The destination reaches an already-unmounting window through `AnimatePresence custom`. Until
  the taskbar exists (phase 5) the target is the bottom centre of the desktop, and
  `setMinimiseAnchor` is the hook the taskbar will register real button positions through.
- **Z-order is renumbered, not incremented.** Raising a window re-stacks the whole set from its
  current order, so z-indices cannot climb forever across a long session.
- **One window per target.** Opening "Games" twice raises the window already showing it, and
  un-minimises it, rather than stacking an identical second one.
- **Window chrome is theme data**: `tokens.json` gains a `window.*` group (`radius`,
  `titleBarHeight`, `resizeGrab`). Only the focused window carries a backdrop blur - several
  blurred surfaces over a shader wallpaper is a real GPU cost (R12) and an unfocused window does
  not need to advertise depth.
- 60 tests across the three `src/wm` files, including the layer as it actually mounts: which
  windows render, that the focus scope follows the focused one and is released with it, and that
  clicking anywhere in a background window raises it.

### Fixed (found while verifying phase 3 in the running app)

- **The shell rendered a blank page inside Tauri.** `onCoreEvent` reassigned its local
  unsubscribe to the *combined* unsubscribe, so that function called itself: every cleanup blew
  the stack. React's development double-invoke runs a cleanup on first mount, which took down
  `ThemeProvider`, `InputProvider` and `Shell` in turn. The browser mock returns before that line
  and was unaffected, which is why it had never been seen in `npm run dev`. The unsubscribe is
  now `const` and idempotent, and `src/bridge/events.test.ts` covers both environments - the
  Tauri path previously had no test at all.
- **The second Ctrl+Tab did nothing.** The keyup handler rebuilt the action from `event.key`
  alone - correct for a plain key, since modifiers may be released first and a held direction
  must always let go - but a chord cannot be recovered that way: `Tab` alone is bound to nothing,
  so `nextWindow` was pressed and never released, and `createRepeater` ignores a press for an
  action it already holds. The provider now remembers what each physical key started and releases
  exactly that.
- **The corner resize handles were nearly unhittable.** With the radius and `overflow: hidden` on
  the same element, the rounded corner clipped the corner handles away -
  `elementFromPoint` at the very corner returned the desktop behind. The window is now a
  non-clipping geometry box with a `.aura-window-frame` inside it that does the clipping, and the
  handles are siblings of the frame: they straddle the edge, half outside the visible border, the
  way a real window manager's resize border does. Corners are twice the size of the edges.
- **Unfocused windows showed the desktop through them.** The frame's fill mixed an opaque colour
  with a translucent one, leaving it ~93% opaque; with no `backdrop-filter` on unfocused windows,
  desktop icons ghosted straight through the window body. Translucency and blur now travel
  together: the focused window is glass, every other window is opaque.

### Added (desktop shell, phase 4 of 8: folders open as windows)

- **Three layouts per folder**, chosen from the window's toolbar and stored on the folder:
  `grid` (artwork tiles), `list` (a dense row each - the only one that survives a folder of
  hundreds) and `covers` (large artwork, no captions). The layout is data on the folder, so the
  folder editor and a theme can set it too.
- **All three folder kinds**, with an empty state that says *why* it is empty: a filesystem folder
  is not browsable until V2, a collection has nothing added, a smart folder's filter matches
  nothing. "Nothing here" alone is not something a user can act on.
- **Folders reopen where they were left** (`folders.window_state`), maximised if they were. The
  geometry is written once, 700 ms after the window settles - never per drag frame - is flushed
  when the window closes or minimises, and is *not* written back on open. A position saved on a
  bigger monitor is still constrained to the current desktop.
- `OpenWindowSpec.size`: a preferred size that still cascades, fitted inside the desktop.

### Added (desktop shell, phase 5 of 8: the taskbar)

- **Pinned entries, running windows and a system area.** "Running" is derived from open windows
  every render and never stored, so it cannot go stale; a minimised window keeps its button,
  because it is on screen nowhere else.
- **Buttons behave like a taskbar's**: a background window comes to the front, the focused one
  minimises, a minimised one is restored. Used from another screen, a button goes to the
  desktop and *shows* the window rather than toggling it.
- **Any of the four edges, buttons centred or from the start** - new settings `taskbarPosition`,
  `taskbarAlignment`, `taskbarVisible`. One rule set covers every edge: the frame flips its flex
  direction, so the DOM order - and with it reading and tab order - never changes.
- **Real system values**: new command `get_system_status` reads battery and charging through
  `GetSystemPowerStatus` (raw FFI, the project's convention). It never fails - a desktop PC
  reports `hasBattery: false` rather than drawing an empty battery forever. The clock is
  `new Date()`: a round trip per second for the time the webview already knows would be absurd.
- **Minimise now flies to the window's real taskbar button**, which registers its position through
  `setMinimiseAnchor` - the hook phase 3 left for exactly this.
- It is Aura's own bar, inside the shell window. The Windows taskbar is never moved, hidden or
  replaced (docs/RISKS.md R3, R13).

### Added (desktop shell, phase 6 of 8: the folder editor)

- **A window, not a modal**, because the point of it is the live preview: the folder being edited
  stays visible beside it. Name, shape, colour, icon, cover image and layout, and delete - which
  removes the folder and never the games in it.
- **Every change restyles on the click.** Folder edits are optimistic in the store, so the desktop
  icon and any open window of that folder change before the core answers, and roll back if it
  refuses. The name is the one field held locally and committed on blur or Enter; a keystroke
  per database write would be absurd.
- **The shape list is the active theme's**, never a hard-coded set. Colours are a short palette
  plus "theme colour", because an arbitrary colour on a themed silhouette fights the theme.

### Added (desktop shell, phase 7 of 8: Settings as a windowed app)

- **Two panes and a search box.** Categories on the left, rows on the right; search cuts across
  every category at once and matches label, hint and extra keywords, requiring every word typed
  ("controller" finds Gamepad). A new *Desktop* category holds the taskbar settings.
- **One catalog, two mountings.** Every setting is defined once, in
  `components/settings/catalog.tsx`, and rendered by both the Settings window and the Settings
  screen - so the two cannot drift and search has one list to search.
- **Settings is an app, not a place.** The nav bar's Settings opens it in a window; the
  PageUp/PageDown screen cycle skips it.
- **Switching theme goes through `set_active_theme`**, which loads and validates the theme before
  committing to it, rather than writing `themeId` and hoping.
- Searching for "music" lands on the one row that says Aura Shell plays none.

### Added (desktop shell, phase 8 of 8: theme extension and a second theme)

- **New tokens**: `window.opacity`, `window.titleAlign`, and a `taskbar` group (`size`, `radius`,
  `inset`). `inset` and `radius` are the whole difference between a docked bar and a floating
  card.
- **A second bundled theme, `aura-paper`**: light, flat and square-cornered, a serif display face,
  a floating taskbar, centred window titles, its own folder shapes (binder, envelope, crate) and
  an SVG wallpaper instead of a shader. It is a manifest, `tokens.json`, `layout.json`,
  `theme.css` and SVGs - no component knows it exists. Its shapes cut detail *out* with evenodd
  holes, because a CSS mask only sees alpha and flattens anything painted on top.
- **Folder shapes are per theme.** A folder whose shape the active theme does not offer is drawn
  with that theme's first shape, so switching theme restyles existing folders instead of
  leaving them all on the generic fallback.
- **Both validators warn about glass without blur** - `blur.surface: 0` with a translucent
  `window.opacity` - which would bring back the ghosting fixed in phase 3.
- **`crates/aura-core/tests/bundled_themes.rs`**: every theme in `themes/` must be listed (not
  silently skipped as invalid), load, keep every folder shape and have all five sounds.
  `npm run theme:validate` now checks both themes.

### Fixed (found while verifying phases 4-8 in the running app)

- **A folder's colour, cover or label could never be cleared.** `FolderPatch` used plain
  `Option` fields, so the editor's `{ "color": null }` deserialised to `None` - "unchanged" - and
  the core answered with the old colour, which the UI then put back. The clearable fields are now
  three-state (absent / `null` / value). The browser mock spread `null` over the folder and so
  hid the bug from every test. `DesktopItemPatch` has the same shape for `labelOverride` and
  `iconOverride`; nothing in the UI clears those yet.
- **Opening Settings slid the whole desktop 72 px up under the nav bar.** The window opened
  hanging below the desktop's edge, and focusing a control inside it made the browser scroll
  `.aura-main` - `overflow: hidden` still has a scroll position - to reveal it. Fixed twice over:
  a window opened at a preferred size is fitted inside the desktop, and the surface is now
  `overflow: clip`, which has no scroll position to move.
- **Windows sat inside the scroller the other screens use.** The window layer now exists only on
  the desktop, and leaving it releases window focus: otherwise the focused window's scope would
  have confined the D-pad to a window that was not on screen. Taskbar buttons and the window
  shortcuts go to the desktop first.
- The folder editor's preview glyph had no box to size itself to, and the taskbar was missing
  from the focus engine's chrome groups.

### Fixed (fix brief #3: window controls and fullscreen by default)

- **The minimise / maximise / close buttons did nothing.** They are the in-app windows'
  controls; there was no shell-level title bar. The title bar's drag handler captured the pointer
  on *every* press, including presses that began on its buttons, and pointer capture retargets
  the pointerup to the capturing element - so the browser delivered the click to the title bar,
  never to the button. Nothing was covering them: `elementFromPoint` returned the button itself.
  A press on a control no longer starts a drag, and a double press on one is no longer read as a
  title-bar double-click. Earlier checks clicked with `element.click()`, which skips pointer
  events entirely; this was verified with real mouse input.
- **A title bar for the windowed shell** (the brief's Option B). Fullscreen - the default - has no
  chrome at all, but a borderless *window* could not be moved, minimised or closed with a mouse.
  `ShellTitleBar` is drawn only when the shell is not fullscreen. The bar and its label are a Tauri
  drag region and the buttons deliberately are not; double-click maximises; minimise goes to the
  taskbar; maximise is the windowed maximise and never fullscreen; close opens the exit
  confirmation rather than calling `exit_shell`. Every button is a focusable in a `titlebar`
  group, reachable with Up from the nav bar, so it works from a keyboard or a pad.
- **Window operations go through the bridge.** New commands `get_window_state` and
  `toggle_maximize_shell`, owned by `shell_host::window`, with all four mirrors updated and the
  mock doing real browser fullscreen. The capability file gains only `start-dragging` and
  `internal-toggle-maximize`, which the drag region itself calls; everything else is Rust.
- **Fullscreen is one preference, applied at once and remembered.** F11 and the Settings row -
  now "Fullscreen" rather than "Start fullscreen" - both apply immediately. `set_fullscreen`
  persists `startFullscreen` (never in a `--smoke` run), and a settings change is applied live.
  Leaving fullscreen restores the windowed geometry from before it was entered: the window is
  created fullscreen, so what the OS would otherwise restore is the config's 1920x1080 fallback,
  larger than a 1366x768 display.
- **`npm run smoke` exists.** `args.rs` and the brief referred to it; it did not. It builds the
  host and runs `--smoke` against a throwaway data directory, as CI's smoke job does.
- Already in place since fix brief #1, and verified here rather than changed: the window is
  created fullscreen, fullscreen is re-asserted after the window is shown, windowed size is a
  fraction of the actual monitor, and a launch leaves fullscreen before minimising and restores
  the remembered state afterwards.
- `.aura-root` is now always a column with the title bar across the top; the taskbar-edge
  arrangement moved to `.aura-shell-body`.

### Fixed (text layout and the exit hotkey)

- **The game name no longer sits under the artwork.** The focus scale moved from the button to
  `.aura-tile-wrap`, so the caption grows and moves *with* the artwork instead of being painted
  over by it. Previously `scale(1.08)` about the button's centre pushed a 330px-tall tile ~13px
  past its own box, plus ~5px of focus ring, onto a caption starting 8px below - and since the
  caption is `opacity: 0` until focused, it was covered in the only state it is ever visible in.
- **`--tile-focus-scale` is a real token.** `Tile.tsx` read a hard-coded `1.08`, so a theme
  changing `tile.focusScale` changed nothing and no CSS could reserve space for the true scale.
  It is now read via `focusScaleFrom()` and shared through the theme context, and the CSS derives
  `--tile-focus-bleed` from `--tile-width`, `--tile-aspect` and `--tile-focus-scale` - correct at
  every tile size, UI scale and theme.
- **Rows no longer clip their own tiles.** `overflow-x: auto` forces the block axis to compute to
  `auto` as well, making `.aura-row-items` a vertical clip container; its padding (and
  `.aura-grid`'s row gap) now clears the scale bleed, focus ring and caption, with matching
  `scroll-padding-block`.
- **The hero cannot be scrolled over.** It was absolutely positioned at `z-index: 1` beneath
  `.aura-main` at `z-index: 2`; any scroll painted row titles across the hero's own text. It is
  now a block in normal flow at the top of the scroller, so rows push it instead.
- **Nothing scrolls before the user asks.** Reveal-on-focus is gated on real interaction rather
  than on "is this the first placement", because startup places focus twice (nav bar, then
  content). Hover also requires the pointer to have actually moved - the shell opens fullscreen
  under wherever the cursor already was, and Chromium fires `mouseenter` for whatever lands
  beneath it, which used to yank the view on launch.
- **UI Scale scales text.** It was applied to `.aura-root`, a `<div>`; `rem` resolves against the
  *root* element, so no `rem` font-size in shell.css responded. It is now on `html`. Tile width
  scales with it too, so captions stay proportionate; `--spacing-*` deliberately does not.
- **A font is bundled.** Inter Variable (SIL OFL, `src/assets/fonts/`) via `@font-face`, so
  metrics are identical on Windows 10, Windows 11 and a dev machine. `'Segoe UI Variable'` was
  never a real family name and had always fallen through.
- **Exit hotkey.** The default was `Ctrl+Shift+Escape`, which Windows reserves for Task Manager
  and never grants to an application - the documented escape hatch had never worked once. Now
  `Ctrl+Alt+Q`, with `is_reserved_hotkey` refusing reserved combinations at the settings boundary,
  a one-time repair of the value stored by existing installs, `get_exit_hotkey_status` so the UI
  can report a failure instead of advertising a dead key, an activatable Settings row that cycles
  known-good accelerators, and re-registration on change that claims the new binding before
  releasing the old so a failed rebind can never leave the shell with none.

### Fixed (pre-existing, found by building the project for the first time)

- The workspace did not compile. `theme/mod.rs` and `theme/loader.rs` used `r#"…"#` around JSON
  containing `"#` (a hex colour), which closed the string early; `SgdbResponse<T>` needed an
  explicit `serde(bound)` because `#[serde(default)]` on `data` made the derive infer `T: Default`.
- `is_tool` filtered the real game "Protonwar" out of the library as a Proton tool - the code's
  own comment claimed `starts_with("proton")` prevented this, which it does not. Now word-boundary
  matched.
- `cargo clippy --workspace --all-targets -- -D warnings` passes for the first time (raw-string,
  doc-list, `sort_by_key`, `field_reassign_with_default`, `assert_eq!(x, false)` and
  `chunks_exact` lints across both crates).

### Removed

- **No music or soundtrack playback, by design.** The short interface sounds (`move`, `select`,
  `back`, `launch`, `error`) are the only audio the app produces, and the ways to get a second
  audio source are closed rather than defaulted off:
  - **IPC contract change.** `WallpaperSetting::Video` no longer has a `muted` field, and
    `Settings.musicVolume` is gone - mirrored in `crates/aura-core/src/config/settings.rs`,
    `src/bridge/types.ts` and [docs/IPC.md](docs/IPC.md). A `muted` key or a `musicVolume` key in a
    stored settings document or a theme's `layout.json` is ignored, so existing installs and older
    themes keep loading; `update_settings` rejects `musicVolume` as an unknown key.
  - Video wallpapers are hard-muted in `Background.tsx` (`muted`, plus a ref that pins
    `muted`/`volume` and re-applies on `volumechange`), so neither a setting nor an untrusted
    community theme can request an audio track.
  - The "Wallpaper volume" row is gone from Settings; it controlled nothing.
  - `theme::loader` drops any sound slot outside `SOUND_SLOTS`, so a theme cannot smuggle a music
    file into the bundle by inventing a slot for it.
  - The Media placeholder screen no longer advertises "music playback"; it describes wallpaper
    management, which is what V2 will actually ship.

### Security

- Content Security Policy and Tauri capability allow-list for the main window
  (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`). The asset protocol scope is
  still `**` in V1 and must be narrowed before a public release.

[Unreleased]: https://github.com/aura-shell/aura-shell/compare/main...HEAD
