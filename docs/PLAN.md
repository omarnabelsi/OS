# AURA SHELL - Project Plan v1.0

*A console-style, fully themeable shell for Windows. Working codename: your PC, re-skinned as a console.*

Prepared 3 September 2026. Scope: feasibility, architecture, framework selection, 3 prototype
phases, requirements, risk register, roadmap and UI design brief. Planning document - subject to
revision after V1 prototype review.

---

## Section 01 - What we are building

Aura Shell is a fullscreen, gamepad-friendly, deeply themeable shell layer that sits on top of
Windows and replaces the visual desktop experience. Instead of a taskbar, desktop icons and
Explorer windows, the user sees a console interface: a horizontal nav bar, large artwork tiles
for apps and games, an animated background, and a file browser with skinnable folders. Windows
keeps running normally underneath - the same files, the same programs, the same drivers. Only
the face of the machine changes.

### How it differs from what already exists

| Product | What it does | What it does not do |
| --- | --- | --- |
| Steam Big Picture | Console-style launcher for Steam games | Not themeable, Steam-only, no file management, does not replace the desktop |
| Playnite Fullscreen | Multi-store game library, skinnable, open source | Games only - no file manager, no shell takeover, no animated wallpaper engine |
| LaunchBox / BigBox | Emulator-focused front end with themes | Heavy, retro-focused, paid, not a desktop replacement |
| Wallpaper Engine / Lively | Animated wallpapers on the Windows desktop | Wallpaper only - no UI, no launcher, no navigation |
| **Aura Shell** | All four at once: launcher + file shell + wallpaper engine + theme platform | This combination does not exist today. That is the opening. |

### The one-sentence pitch

> "Wallpaper Engine skins your background. Playnite skins your games. Aura Shell skins your whole
> computer - and you drive it with a controller from the sofa."

### Core product principles

- **Windows still works.** Nothing is broken, nothing is deleted. The user can leave at any moment with one hotkey.
- **Everything is a theme.** The nav bar, tiles, folders, sounds, transitions and wallpaper are all data, not code. The app ships with themes; the community makes more.
- **Controller-first, mouse-friendly.** Every screen must be fully usable with a D-pad. Mouse and touch are supported but never required.
- **60 fps or it is broken.** A console UI that stutters feels cheap. Motion quality is the product.
- **Reversible.** A single 'Restore Windows' button must always undo everything, even in safe mode.

---

## Section 02 - Is it possible? Feature-by-feature verdict

Short answer: yes, every feature is technically achievable on Windows 10 and 11. But the features
sit at three very different difficulty levels, and two of them carry real risk. Build the green
rows first, budget extra time for the amber, and treat the red as opt-in advanced features.

| Feature | Verdict | Effort | How it is actually done |
| --- | --- | --- | --- |
| Fullscreen console-style UI on top of everything | Yes | Low | Borderless fullscreen window, topmost flag, per-monitor DPI awareness |
| Desktop icons and taskbar disappear | Yes | Low-Med | Hide the Progman/WorkerW and Shell_TrayWnd windows via ShowWindow; restore on exit |
| Fully replace the Windows desktop (true shell) | Yes | High | Set the per-user Winlogon Shell value, or Shell Launcher v2 (Enterprise/Education only). Side effects - see risk register. |
| Run games and apps from the UI | Yes | Low | CreateProcess for .exe, `steam://rungameid/ID`, `com.epicgames.launcher://`, `shell:AppsFolder` for Microsoft Store apps |
| Auto-detect installed games | Yes | Medium | Parse Steam `libraryfolders.vdf` + `appmanifest_*.acf`, Epic manifests in ProgramData, GOG and EA registry keys, UWP package list |
| Box art, logos, hero images | Yes | Low | Steam CDN + SteamGridDB API + IGDB, with manual override and local cache |
| Animated wallpaper behind the UI | Yes | Medium | Render video / shader as the app's own background layer. Far simpler and safer than the WorkerW injection trick used by wallpaper tools. |
| Custom folder shapes, colours, cover art | Yes* | Medium | Inside your own file browser you draw folders however you like. Changing how real Explorer draws folders is not realistic - only desktop.ini icon overrides. |
| Copy, move, delete, rename files | Yes | Medium | IFileOperation COM interface - real Windows progress dialogs, Recycle Bin and undo for free. Do not hand-roll file copying. |
| Controller navigation everywhere | Yes | Medium | XInput or SDL2/gilrs for input, plus a custom spatial focus engine in the UI layer |
| Volume, Wi-Fi, Bluetooth, battery, power menu | Yes | Medium | Windows Core Audio API, WinRT Radio and WiFi namespaces, SetSuspendState / ExitWindowsEx |
| Community theme store | Yes | Med-High | Themes as signed, sandboxed packages; a small backend for browse, rate, install |
| In-game overlay (FPS, chat, screenshots) | Risky | High | Requires DirectX hooking. Anti-cheat systems block or ban this. Defer past V3 or use a non-hooking sidebar instead. |
| macOS / Linux version | Partial | High | The launcher layer ports fine. Shell replacement is Windows-specific and would need a complete rewrite per platform. |

### Five things you must know before writing any code

1. **Replacing explorer.exe breaks more than you think.** You lose the system tray, toast notifications, some installers, Win+E, Explorer right-click menus, and any app that hosts itself in the shell. The default must be Overlay Mode (Explorer still runs, just hidden) with True Shell Mode as an advanced opt-in.
2. **The official API is edition-locked.** Shell Launcher v2 only exists on Windows Enterprise and Education. On Home and Pro you must use the per-user Winlogon registry Shell value, which is less supported and needs a manual recovery path.
3. **Antivirus will fight you.** Hiding the taskbar, setting a shell, enumerating processes and launching executables is exactly the behaviour profile of malware. Without an EV code signing certificate, SmartScreen and Defender will scare off most users on day one. Budget for the certificate before public release.
4. **Detecting when a game closes is genuinely hard.** Steam games launch through a chain of child processes; the process you started often exits in two seconds while the game runs on. You need process-tree watching plus foreground-window heuristics. Plan a week for this alone.
5. **Do not ship Sony or Microsoft assets.** Themes 'inspired by' PS5, Xbox or PS3 XMB are fine. Shipping their actual icons, fonts, sounds, wave shaders or trademarks is not. Commission original art that captures the feel.

---

## Section 03 - System architecture

The single most important architectural decision is to split the dangerous native work away from
the beautiful UI work. The native core talks to Windows; the UI layer only ever talks to the core
through a narrow, well-defined message bridge. That separation lets community themes be safe, lets
the UI be rewritten without touching shell code, and lets a crash in one layer not take the machine
down with it.

| Layer | Name | Responsibility |
| --- | --- | --- |
| 5 | Theme & plugin runtime | Theme packages (manifest + CSS/assets + optional sandboxed script), hot reload, validation, store client |
| 4 | UI layer (the visible product) | Nav bar, tile rows, focus/parallax/blur motion, file browser views, settings, overlays, sounds |
| 3 | IPC bridge | Typed request/response and event stream between UI and core. The only door between the two worlds. |
| 2 | Core services (native) | Library service (store scanners, metadata, artwork), File service (IFileOperation), Media service (wallpaper playback), System service (audio/network/power), Input service (gamepad), Process service (launch and watch) |
| 1 | Shell host (native) | Window and monitor management, desktop/taskbar hiding, shell registration, global hotkeys, single-instance guard, crash watchdog and auto-recovery |

### Data model (SQLite)

A single local database keeps the UI fast. Scanning stores is slow and must never block the
interface - scanners run in the background and push updates to the UI as events.

| Table | Holds |
| --- | --- |
| entries | Every launchable item: id, name, type (game/app/link/folder), source (steam/epic/manual), launch command, install path, install size |
| artwork | Local cache paths for grid, hero, logo, icon, plus source and user-override flag |
| stats | Playtime, launch count, last played, favourite flag, hidden flag |
| collections | User-made groups and smart filters (recent, installed, by store, by genre) |
| folders | Pinned locations plus their per-folder skin: colour, icon, cover image, layout |
| themes | Installed theme id, version, enabled state, user token overrides |
| settings | Key-value store for everything else; exportable as JSON for backup and sync |

### The theme package format - design this early

If themes are an afterthought they will always be limited. Define the format in V1 even if only
your own themes use it. A theme is a folder:

```text
mytheme/
  manifest.json   name, author, version, screenshots, min app version
  tokens.json     colours, radii, blur, spacing, easing curves, tile sizes
  layout.json     which regions exist and what goes in them
  theme.css       overrides and custom components
  assets/         fonts, icons, folder shapes, wallpapers
  sounds/         move, select, back, launch, error
  shaders/        optional GLSL for animated backgrounds
```

---

## Section 04 - Choosing the framework

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| **Tauri 2** (Rust core + WebView2 UI) | Very small binary (10-20 MB) and low RAM. Rust handles Win32/COM cleanly. CSS, WebGL and Framer Motion give console-grade animation. Themes become CSS - ideal for a community. | Rust learning curve. Depends on WebView2 runtime. Video behind a transparent UI needs care. | **RECOMMENDED** - best balance of native power and visual freedom |
| Electron | Fastest path to something on screen. Enormous ecosystem. | 200 MB+ RAM idle, 150 MB install for a permanent app. Native work needs C++ addons. | Throwaway V1 mock only |
| .NET 8 + WPF (the Playnite path) | Best-in-class Windows integration. Hardware accelerated. Proven by Playnite. | XAML theming far less expressive than CSS. Smaller pool of designers. | Strong second choice if the team is C#-first |
| Avalonia UI (C# + Skia) | GPU-rendered custom drawing, cross-platform, modern XAML | Smaller ecosystem; still needs P/Invoke for shell work | Viable if cross-platform matters later |
| Godot 4 as the front end | Unmatched motion, shaders, particles. Gamepad navigation native. | Poor at text-heavy UI and file browsing. Awkward for Windows APIs. Themes would be scenes, not styles. | Only for the animated background module |

### Recommended stack

Rust + Tauri 2 for the shell host and core services, React + TypeScript for the UI, Framer Motion
for transitions, Three.js or OGL for shader backgrounds, SQLite for the library.

| Area | Choice | Why |
| --- | --- | --- |
| Shell / native core | Rust, windows-rs crate | Safe access to Win32, COM and WinRT with no GC pauses |
| App framework | Tauri 2 | Native window control plus a web UI, at a fraction of Electron's weight |
| UI | React, TypeScript, Vite | Component model suits tile grids; fastest iteration loop |
| Styling | CSS variables + Tailwind | Design tokens map one-to-one onto theme files |
| Motion | Framer Motion | Spring physics and shared-element transitions - the console feel |
| Backgrounds | WebGL2 (Three.js / OGL / raw) | Shader wallpapers, depth blur, particle fields |
| Video wallpaper | HTML5 video (WebView2 HW decode) / libmpv later | Hardware-decoded looping video with low CPU cost |
| Gamepad | gilrs or SDL2 | Xbox, DualShock 4, DualSense and generic pads in one API |
| Database | SQLite (rusqlite) | Zero-config, fast, single file, trivial to back up |
| File operations | IFileOperation (COM) | Real Windows copy semantics, progress, undo and Recycle Bin |
| Metadata | SteamGridDB, IGDB, Steam CDN | Artwork and game data; free API tiers |
| Hardware stats | LibreHardwareMonitor | CPU/GPU temp and load without kernel drivers of your own |
| Installer | Tauri bundler, NSIS/MSI | Signed installer plus a clean uninstall that restores Windows |
| Updates | Tauri updater | Signed delta updates with rollback |
| CI | GitHub Actions (windows-latest) | Build, sign and publish on every tag |
| Design | Figma with token export | Design tokens flow straight into theme files |

---

## Section 05 - The three prototypes

Each version answers one question and is genuinely usable on its own. Do not start the next one
until the current question is answered honestly.

| | V1 - The Face | V2 - The Shell | V3 - The Platform |
| --- | --- | --- | --- |
| Question it answers | Does it feel like a console? | Can I actually live in it all day? | Will other people build for it? |
| Stage | Prototype / MVP | Alpha | Beta to 1.0 |
| Estimate | 6-8 weeks | 10-14 weeks | 12-20 weeks |
| Ships to | You and 5 friends | Closed alpha, ~100 testers | Public release |
| Risk level | Low | Medium | High |

### V1 - "The Face" / Prototype / 6-8 weeks

A beautiful fullscreen launcher. Not a shell yet, not a file manager yet. It runs as a normal app
you can alt-tab out of. Its entire job is to make you feel something when you move between tiles.

**In scope**

- Borderless fullscreen window with a clear exit hotkey; correct behaviour on multi-monitor and high-DPI setups
- Home screen: horizontal nav bar (Games / Apps / Files / Media / Settings) and a scrolling row of large artwork tiles
- Focus motion: tile scale, parallax on the hero art, background blur and colour bleed from the focused item, and a sound on every move
- Add items manually by browsing to an executable, plus one automatic scanner - Steam
- Artwork pipeline: fetch grid/hero/logo from SteamGridDB with a manual replace option and a local cache
- Launch: start the target, hide the shell, watch the process tree, return cleanly when it exits
- One complete built-in theme with original art, plus a static image and looping video background
- Full navigation with keyboard, mouse and gamepad - the same screens, three input methods
- Settings: wallpaper, accent colour, tile size, UI scale, sound volume

**Explicitly out of scope**

- No taskbar or desktop hiding, no shell registration, no autostart
- No file browser, no folder theming, no multi-store scanning, no theme packages (beyond the built-in format)

**Milestones**

| Week | Deliverable | Done when |
| --- | --- | --- |
| 1 | Project skeleton, fullscreen window, IPC bridge, design tokens | An empty themed window opens fullscreen and exits cleanly |
| 2 | Spatial focus engine and gamepad input service | A D-pad moves focus through a grid without a mouse, at 60 fps |
| 3-4 | Tile row, hero panel, motion and sound design | Someone watching over your shoulder says "that looks like a console" |
| 5 | Steam scanner, SQLite library, artwork fetch and cache | Your real Steam library appears with correct art in under 3 seconds |
| 6 | Launch, hide, watch and return flow | Three different games launch and return to the shell reliably |
| 7-8 | Settings, video wallpaper, polish, first build for friends | Five people install it and give feedback without your help |

**V1's real risks**

Spatial navigation is much harder than it looks - budget a full week. Game exit detection will
break on Steam titles the first time you try it.
