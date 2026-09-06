# Risk register

Expands PLAN.md section 02. Reviewed at the end of each prototype phase. Ordered by how likely a
given risk is to actually bite, not by how dramatic it sounds.

Status key: **Live** - present in V1 today. **Deferred** - the design keeps it out of V1.
**Watch** - not yet a problem, will be.

---

## R1 - Antivirus and SmartScreen treat us as malware

**Status: Live. Severity: high. This is the one that decides whether anyone installs it.**

Enumerating processes, launching executables, reading the registry, hiding the taskbar and
registering a shell is, behaviourally, indistinguishable from a dropper. Without an EV code
signing certificate, SmartScreen will show "Windows protected your PC" to every first-time user
and most will stop there.

- Now: nothing in V1 hides the taskbar or writes to `Winlogon`. The behavioural profile stays as
  boring as possible.
- Before any public release: buy an EV certificate and sign the installer and the binary. Budget
  for it as a real line item, not an afterthought.
- Submit builds to Microsoft and the major AV vendors for whitelisting.

## R2 - Game exit detection is wrong

**Status: Live. Severity: high. Wrong in either direction is user-visible and annoying.**

`steam://rungameid/620` hands off to the Steam client; the process we started exits in ~2 s while
the game runs for hours. Declaring an exit too early pops the shell over a running game;
declaring it too late leaves the user staring at a minimised shell.

Mitigation is `process/watch.rs`: three OR-ed signals (process tree, anything running under
`install_path`, foreground window ownership), a 15 s startup grace for Steam's bootstrap, and a
3 s debounce before believing an all-clear.

Known gaps, all of which will need real-hardware testing:

- A game installed outside its Steam `installdir` (mods, custom paths) weakens signal B.
- Launchers that keep a background process alive after the game closes will delay the exit.
- Manual entries with no `install_path` fall back to the exact exe path only.

The exit hotkey is the escape hatch and must never be removed.

## R3 - Replacing explorer.exe breaks the machine

**Status: Deferred to V2, and opt-in when it lands. Severity: critical if mishandled.**

Setting the per-user `Winlogon` `Shell` value loses the system tray, toast notifications, some
installers, Win+E and Explorer context menus. A crash loop in that state leaves a user with a
black screen and no shell.

V1 runs in Overlay Mode only: Explorer keeps running and is never hidden. `ShellMode::TrueShell`
exists in the model as a placeholder and is not implemented.

Before it ever ships:

- an external watchdog process that restores `explorer.exe` if the shell dies twice in a row;
- a documented safe-mode recovery path (regedit from a recovery console);
- a "Restore Windows" button that works from inside safe mode;
- Shell Launcher v2 where the edition allows it (Enterprise/Education only), registry otherwise.

## R4 - Spatial navigation feels wrong

**Status: Live. Severity: medium, but it is the whole product.**

"Press right and the thing I expected gets focus" is deceptively hard: nested scrollers, wrapped
grids, mixed tile sizes, elements that are laid out but not visible.

`src/focus/geometry.ts` is pure and unit-tested precisely so this can be reasoned about rather
than tuned by feel. The rule: forward progress along the direction of travel, plus a heavy
penalty (30x) for drifting off the current row or column. The test suite pins the cases that
actually broke during development - nav-bar-to-tile, tile-to-nav-bar, and "prefer the aligned
neighbour over a nearer diagonal one".

Rects are read live rather than cached; caching is the bug that returns here.

## R5 - A theme can break or abuse the shell

**Status: Live. Severity: medium.**

Themes are untrusted content the moment anyone shares one.

- Every referenced path is validated: relative only, no `..`, must exist inside the folder.
- Theme ids must be kebab-case and equal the folder name, so `locate(id)` is a plain path join
  and cannot traverse.
- A manifest that fails validation is skipped with a warning; it does not take the app down.
- A shader that will not compile is logged and the flat ground renders instead.
- `base.css` carries a complete fallback palette, so a partial or broken theme still leaves a
  usable screen.

Not yet addressed: a theme with a pathological shader can still tank the frame rate, and CSS can
still hide UI. Sandboxed theme scripts (V3) will need a real permission model.

## R6 - The artwork pipeline is rate-limited or offline

**Status: Live. Severity: low.**

SteamGridDB has a free tier with limits; the Steam CDN does not need a key but does not have art
for everything.

Requests are throttled to ~4/sec, one batch thread handles a whole scan rather than one thread
per game, downloads are atomic (`.part` then rename), non-image content types and files over
25 MB are refused, and an already-cached file is adopted without a network call. A missing logo
is not an error; only a complete failure raises one warning toast.

A library with no art is ugly, not broken: tiles fall back to a generated placeholder.

## R7 - Multi-monitor and mixed DPI

**Status: Live. Severity: medium. Under-tested.**

Fullscreen on the wrong monitor, or a window that half-renders across two displays with different
scale factors, is a common Windows failure and hard to catch without the hardware.

`monitor_index` selects a display and `shell_host/window.rs` positions the window before going
fullscreen. This needs testing on a real mixed-DPI setup; a per-monitor-v2 DPI awareness manifest
may be required.

## R8 - Data loss in the library database

**Status: Live. Severity: low, rising with V2.**

Playtime, favourites and artwork overrides only exist in `aura.db`.

Scans never delete: an entry whose files have gone is logged, not removed. Matching on
`(source, source_id)` means a rename keeps the id and therefore the history. Schema changes go
through `PRAGMA user_version` migrations. Settings are exportable as JSON.

Missing: an automatic backup before a migration, and a documented restore. Worth adding before
V2 puts file operations anywhere near this.

## R9 - WebView2 missing or old

**Status: Live. Severity: low on Windows 11.**

Windows 11 ships the Evergreen runtime; older Windows 10 may not have it. The installer is
configured with `downloadBootstrapper`, so it fetches the runtime silently at install time. An
offline installer needs the embedded bootstrapper instead.

## R10 - In-game overlay and anti-cheat

**Status: Deferred past V3. Severity: critical if attempted carelessly.**

An FPS/chat/screenshot overlay means hooking DirectX. Anti-cheat systems block that, and in the
worst case ban the user's account. No amount of product value justifies getting a player banned.

If it is ever built, it must be opt-in, per-game, off by default, and clearly explained. A
non-hooking sidebar that does not touch the game's process is the sane alternative.

---

## Known limitations in the current build

Honest inventory of what V1 does not do, so nothing here is a surprise later.

- Files and Media are placeholder screens. The file browser is V2 (PLAN.md section 05).
- Only Steam is scanned. Epic, GOG, EA and UWP have model support and no scanner.
- The asset protocol scope in `tauri.conf.json` is still `**`. It must be narrowed to the data,
  cache and resource directories before a public release.
- The app icon is a generated placeholder, not commissioned art.
- Theme icons are drawn inline by the UI (`components/Icon.tsx`); a theme cannot yet replace
  them, though the SVGs ship in the package as the reference set.
- There is no theme store, no updater channel and no telemetry.
