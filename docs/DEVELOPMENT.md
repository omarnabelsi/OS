# Development

## Requirements

| | |
| --- | --- |
| Node | 20+ (CI uses 22) |
| Rust | stable, via rustup. `rust-toolchain.toml` pins the components |
| MSVC | Visual Studio Build Tools with **Desktop development with C++** - Rust needs `link.exe` |
| WebView2 | Preinstalled on Windows 11. On older Windows 10, install the Evergreen runtime |

Only the Node half is needed to work on the UI. The two halves can be developed independently -
that is the point of the bridge.

## The two ways to run it

### Browser (no Rust)

```sh
npm install
npm run dev          # http://localhost:1420
```

`src/bridge/index.ts` sees it is not inside Tauri and swaps in `mockApi`: a mutable sample
library, settings in localStorage, simulated scan progress, and a launch that "runs" for four
seconds. Every screen works. Keyboard drives everything; a plugged-in gamepad works through the
browser Gamepad API.

This is the fast loop - hot reload, devtools, no Rust compile. Use it for anything that is not
talking to Windows.

### The real app

```sh
npm run tauri:dev
```

Builds the core, opens the real window, talks to the real Steam install. Slower, and the only way
to test scanning, launching, hotkeys or window behaviour.

Useful flags (`src-tauri/src/shell_host/args.rs`):

```sh
cargo run -- --windowed                 # 1280x720 window instead of fullscreen
cargo run -- --data-dir C:/tmp/aura     # a throwaway database
cargo run -- --smoke 8                  # start, wait 8s, print AURA_SMOKE_OK, exit
```

`--data-dir` is worth the habit: it keeps experiments out of your real library, and
`AURA_DATA_DIR` does the same for tests.

If a fullscreen build ever traps you, the exit hotkey is `Ctrl+Shift+Escape` and it is registered
globally, so it works even from inside a game.

## Checks

```sh
npm run typecheck                       # both tsconfigs
npm test                                # vitest
npm run theme:validate                  # the bundled theme package
npm run build                           # typecheck + vite build

cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

CI runs all of these on `windows-latest` plus a `--smoke` launch of the built binary. The smoke
run is what catches the class of failure a unit test cannot: a missing Tauri capability, a broken
asset path, a theme that will not load.

## Tests

Rust tests live beside the code in `#[cfg(test)] mod tests`. They avoid the network and the
registry; anything touching the filesystem uses `tempfile`. `Core::new` with
`Paths::rooted(tmp, ...)` gives a complete, isolated core in three lines - see
`library/mod.rs`'s `test_core()`.

Frontend tests are vitest + jsdom. The valuable ones are the pure modules:

| File | Covers |
| --- | --- |
| `src/focus/geometry.test.ts` | Spatial navigation: what is actually to the right of this tile |
| `src/input/actions.test.ts` | Key and button bindings, auto-repeat, stick hysteresis |
| `src/theme/tokens.test.ts` | tokens.json -> CSS custom properties, against the real theme file |
| `src/store/store.test.ts` | Optimistic updates, debounce coalescing, rollback, event handling |

Store tests mock `@/bridge` with `fakeBridgeModule()` from `src/store/test-helpers.ts`. The mock
factory is hoisted above the imports, so it has to `await import('./test-helpers')` itself.

## Changing the IPC contract

Three places, always together:

1. `crates/aura-core/src/model.rs` (or `events.rs`) - the Rust side
2. `src/bridge/types.ts` - the TypeScript mirror
3. `docs/IPC.md` - the table that is the actual source of truth

Then `src-tauri/src/ipc/commands.rs` for a new command, and both bridge implementations
(`tauriApi.ts` and `mock.ts`) for a new method. **Update the mock** - forgetting it is how the
browser build silently rots.

Serialisation: fields camelCase, enum variants snake_case, tagged enums use `kind`. Additive
changes are free; renames and removals need a CHANGELOG entry.

## Gotchas

**The SQLite mutex is not reentrant.** A `db::` function must not call another one while holding
`db.conn()`. Scope the guard in a block, then call - see `db/stats.rs`.

**Artwork batches, it does not fan out.** Use `artwork::start_fetch_many` for a set of entries.
One thread, sequential requests, SteamGridDB throttled to ~4/sec.

**Never cache a DOM rect in the focus engine.** Rows scroll, layouts reflow. `candidates()` reads
live rects on every move; that is intentional and cheap enough.

**Sounds fail silently and must stay that way.** Browsers block audio until the first user
gesture. A missing or blocked sound must never break navigation.

**Assets need `assetUrl()`.** The core returns absolute paths; only `assetUrl()` knows how to turn
one into something the webview will load. Components must not import `@tauri-apps/*` directly.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and the reasoning behind the layer
split. [THEME_FORMAT.md](THEME_FORMAT.md) covers theme packages. [RISKS.md](RISKS.md) covers the
things that can go wrong on a user's machine.
