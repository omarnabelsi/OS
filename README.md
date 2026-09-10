# Aura Shell

A console-style, fully themeable shell for Windows. Your PC, re-skinned as a console.

> Wallpaper Engine skins your background. Playnite skins your games. Aura Shell skins your whole
> computer — and you drive it with a controller from the sofa.

Fullscreen, gamepad-first, 60 fps. Windows keeps running underneath: nothing is replaced, nothing
is deleted, and one hotkey always gets you out.

**Status: V1 "The Face" — in development.** A launcher, not yet a shell. See
[the plan](docs/PLAN.md) for what V2 and V3 add, and [the risk register](docs/RISKS.md) for an
honest list of what today's build does not do.

## What it does

- **Home screen** — a nav bar and rows of large artwork tiles, with a hero panel, parallax, blur
  and colour bleed from whatever has focus.
- **Your Steam library, automatically** — parses `libraryfolders.vdf` and the app manifests, then
  fetches box art from SteamGridDB with the Steam CDN as a no-API-key fallback.
- **Anything else, manually** — point it at any `.exe`, shortcut or batch file.
- **Launch and return** — starts the title, steps out of the way, watches the *process tree*
  (Steam's launcher exits in two seconds while the game runs for hours), and comes back cleanly.
- **Controller, keyboard or mouse** — the same screens, three input methods, none of them second
  class.
- **Everything is a theme** — the nav bar, tiles, motion, sounds and animated wallpaper are data,
  not code. See [the theme format](docs/THEME_FORMAT.md).

## Try it without installing anything

The UI runs in a plain browser against a mock of the native core — a real sample library,
simulated scans, working launch flow. No Rust, no Windows APIs.

```sh
npm install
npm run dev          # http://localhost:1420
```

Arrow keys or WASD to move, Enter to launch or open a folder, `M` for the item menu,
`PageUp`/`PageDown` to change screen, Escape to go back. With windows open, `Ctrl+Tab` and
`Ctrl+Shift+Tab` move between them and `F6` steps between the desktop and the front window. A
plugged-in gamepad works too — the shoulder triggers switch windows.

Folders open as windows (grid, list or covers), and the gear in a folder's toolbar opens its
editor. Settings is a window too, with a search box that finds any setting; the taskbar can sit on
any edge. Two themes ship — **Aura** (dark glass) and **Paper** (a light desk) — switch between them
in Settings → Appearance → Theme.

## Build the real thing

Needs Rust (stable) and the MSVC build tools — see [DEVELOPMENT.md](docs/DEVELOPMENT.md).

```sh
npm run tauri:dev      # run it
npm run tauri:build    # build an installer
```

## How it is put together

Rust + Tauri 2 for the native core, React + TypeScript for the UI, SQLite for the library. The
two halves talk through one typed IPC bridge and nothing else — which is what lets community
themes be safe, lets the UI run in a browser, and keeps a crash in one layer from taking the
machine down with it.

| Layer | |
| --- | --- |
| Theme runtime | Theme packages, hot reload, validation |
| UI | Focus engine, screens, motion, sound |
| **IPC bridge** | The only door between the two worlds |
| Core services | Library, artwork, process, input, theme |
| Shell host | Window, monitors, hotkeys, crash watchdog |

[ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the split and where to add things.
[IPC.md](docs/IPC.md) is the contract.

## Documentation

| | |
| --- | --- |
| [PLAN.md](docs/PLAN.md) | Feasibility, framework choice, the three prototypes, roadmap |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, module map, threading, data flow |
| [IPC.md](docs/IPC.md) | Commands, events, serialisation rules |
| [THEME_FORMAT.md](docs/THEME_FORMAT.md) | How to build a theme |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, the two run modes, tests, gotchas |
| [RISKS.md](docs/RISKS.md) | What can go wrong, and current limitations |

## A note on themes and trademarks

Themes *inspired by* a console UI are welcome. Shipping Sony, Microsoft or Nintendo icons, fonts,
sounds or trademarks is not. Make original art that captures the feel.

## Licence

MIT. See [LICENSE](LICENSE).
