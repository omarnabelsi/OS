# Theme package format (`aura-theme/1`)

A theme is a folder. Nothing is compiled, nothing is installed - drop it in the user theme
directory and it appears in Settings.

```text
my-theme/
  manifest.json   identity, version, which sounds and shaders exist
  tokens.json     colours, radii, blur, spacing, easing, tile sizes, fonts
  layout.json     which regions exist, what goes in them, the background
  theme.css       overrides and custom component styling
  assets/         icons, folder shapes, wallpapers, fonts
  sounds/         move, select, back, launch, error
  shaders/        optional GLSL fragment shaders for animated backgrounds
```

Where the folder goes:

| | Path |
| --- | --- |
| Bundled with the app | `<install>/themes/<id>/` (the repo's `themes/` in dev) |
| Installed by the user | `%APPDATA%/AuraShell/themes/<id>/` |

A user theme wins over a bundled theme with the same id, so a theme can be overridden without
touching the install directory.

Validate before shipping:

```sh
npm run theme:validate                       # the bundled theme
node scripts/validate-theme.mjs path/to/theme
```

The script mirrors `crates/aura-core/src/theme/validate.rs`. The two must be changed together.

## manifest.json

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "author": "Your Name",
  "version": "1.0.0",
  "description": "One or two sentences shown in the theme picker.",
  "screenshots": ["assets/screenshots/home.png"],
  "minAppVersion": "0.1.0",
  "engine": "aura-theme/1",
  "sounds": {
    "move": "sounds/move.wav",
    "select": "sounds/select.wav",
    "back": "sounds/back.wav",
    "launch": "sounds/launch.wav",
    "error": "sounds/error.wav"
  },
  "shaders": { "aurora": "shaders/aurora.frag" },
  "hasCss": true
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | kebab-case, and **must equal the folder name** |
| `name` | yes | not blank |
| `author` | yes | |
| `version` | yes | semver |
| `description` | no | |
| `screenshots` | no | relative paths that must exist |
| `minAppVersion` | no | semver; a theme needing a newer app is refused, not half-loaded |
| `engine` | no | defaults to `aura-theme/1`; anything else is refused |
| `sounds` | no | slot -> relative path; missing slots fall back to the default theme |
| `shaders` | no | id -> relative path to a `.frag` |
| `hasCss` | no | defaults to true; if true, `theme.css` must exist |

**Every referenced path must be relative and must stay inside the theme folder.** Absolute paths
and anything containing `..` are rejected. A theme is untrusted content; it does not get to read
`C:\Users\you\Documents`.

## tokens.json

Two levels: `group.key`. Each becomes a CSS custom property `--group-key`, with camelCase
converted to kebab-case (`surfaceStrong` -> `--color-surface-strong`).

```json
{
  "color": { "accent": "#6ee7ff", "surfaceStrong": "rgba(255,255,255,0.12)" },
  "tile":  { "width": "220px", "focusScale": 1.08, "widthLarge": 300 }
}
```

That is the whole mechanism. Add a token and it is available to `theme.css` immediately - no
code change. Numbers stay unitless, which is what `focusScale` needs.

Tokens the shell reads directly. Anything missing falls back to `src/styles/base.css`, so a
partial theme still renders:

| Group | Keys |
| --- | --- |
| `color` | `background` `surface` `surfaceStrong` `text` `textMuted` `accent` `accentContrast` `focusRing` `danger` |
| `radius` | `sm` `md` `lg` `tile` `folderCapsule` |
| `blur` | `background` `surface` |
| `palette` | any number of named colours - the tints the folder editor offers |
| `aurora` | `1`-`6`: the four primary washes of the background field and the two softer ones |
| `spacing` | `edge` `gutter` `row` |
| `easing` | `standard` `emphasized` |
| `duration` | `fast` `base` `slow` |
| `tile` | `width` `aspect` `focusScale` `gap` `widthSmall` `widthMedium` `widthLarge` |
| `desktop` | `cell` `gap` `iconSize` `labelSize` `labelMaxLines` `gridCellW` `gridCellH` `columnGap` `rowGap` |
| `window` | `radius` `titleBarHeight` `controlSize` `controlRadius` `resizeGrab` `opacity` `titleAlign` |
| `taskbar` | `edge` `align` `height` `iconSize` `radius` `margin` `size` `inset` `gap` `padding` `plateRadius` `border` |
| `elevation` | `e1`-`e4`, each with `shadow` `surface` `blur`; `e4` also `scrim` |
| `folder` | `shape` `tintAlpha` `artWidth` `artHeight` `artHeightMax` `tabSlot` `iconSize` `glassTop` `glassBottom` `border` `sheen` `coverScrim` |
| `font` | `family` `display`, and `weight.display` `weight.title` `weight.label` `weight.meta` `weight.section` |

`tile.widthSmall/Medium/Large` back the tile-size setting: the chosen one is written to
`--tile-width`. Bare numbers get `px` appended.

`duration.*` is how a theme participates in reduced motion - the shell collapses all three to
`0ms` when the user asks for it, so motion built on those tokens stops for free.

`window.resizeGrab` is the width of the invisible strip along each window edge that starts a
resize. It is a usability floor as much as a style: below about 6px the edge becomes hard to hit
with a mouse and impossible with a trackpad. The *minimum* window size is not a token - it is a
fixed floor in `src/wm/geometry.ts`, because a theme should not be able to ship a window too
small to use.

`window.opacity` scales the `elevation.e3.surface` tint a *focused* window is filled with. At
`100%` the fill is exactly that token; below it the window is thinner glass. **A theme that sets
`blur.surface` to `0px` must set `window.opacity` to `100%`** - translucency with no blur behind
it shows the desktop icons straight through the window, which reads as a rendering fault rather
than as depth. Both validators warn about that combination. Unfocused windows are always opaque,
for the same reason. `window.titleAlign` is `left` or `center`.

### The elevation ladder

Everything raised in the shell is one of five levels, and the level decides all three of its
shadow, its tint and how much blur it asks for:

| Level | What it is |
| --- | --- |
| `e0` | the desktop field - the thing everything else is raised above |
| `e1` | a desktop item |
| `e2` | the taskbar |
| `e3` | a window (only the focused one gets glass) |
| `e4` | an overlay, plus its `scrim` |

The ladder is deliberately shadow-heavy and blur-light. `backdrop-filter` is the most expensive
thing the shell draws, so at most **three** surfaces blur at once, and a theme's
`elevation.*.blur` is what a surface *asks* for rather than what it necessarily gets: when the
cap binds, desktop items go flat first, and on a machine that cannot hold the frame rate the whole
app falls back to one shared static snapshot of the field. A surface that is refused keeps its
tint, which is why `elevation.*.surface` has to look right on its own - see the flat `aura-paper`
ladder for a theme where it always is.

`blur.surface: 0` turns the whole mechanism off. Set it, set `window.opacity` to `100%`, and give
the levels opaque surfaces; the shadows then carry the depth by themselves.

`taskbar.inset` and `taskbar.radius` are the whole difference between a bar docked flush to the
edge (both `0px`) and a floating card: the inset lifts it off the edge and the radius rounds it.
`taskbar.size` is the bar's width when it is docked left or right. *Which* edge, and whether the
buttons are centred, are the user's settings rather than the theme's.

The two bundled themes are the reference for all of this. `aura-default` is dark glass;
`aura-paper` is a light, flat, square-cornered desk with a floating taskbar, its own folder shapes
and an image wallpaper instead of a shader - and it is nothing but a manifest, `tokens.json`,
`layout.json`, `theme.css` and SVGs. Folder shapes are per theme: a folder whose shape the active
theme does not offer is drawn with that theme's first shape, so switching theme restyles existing
folders rather than leaving them all on the generic fallback.

### Nested groups, and the type scale

Groups nest up to three levels: `font.weight.label` becomes `--font-weight-label`, and
`elevation.e1.shadow` becomes `--elevation-e1-shadow`. Deeper than that is ignored rather than
flattened into an unreadable name.

`font.family` is the family stack. The older `font.ui` still works - everything reads
`var(--font-family, var(--font-ui))` - but new themes should set `family`. The weights carry more
than they look like they do: the type hierarchy is one family at five weights, and the roles in
`src/styles/type.css` read nothing else, so shifting `font.weight.*` re-pitches every clock,
label, title and section header at once. Sizes there are in `rem`, which is what makes the UI
Scale setting move text.

### Folder shapes are geometry, not code

A folder's shape is the most visible thing it has, and it is theme data. Each entry in
`folderShapes` may carry the geometry the desktop draws:

```json
{
  "id": "capsule",
  "asset": "assets/folders/capsule.svg",
  "height": 104,
  "radius": "56px",
  "offsetTop": 24,
  "tab": { "width": 84, "height": 16, "radius": "10px 10px 0 0" }
}
```

`height` is the artwork's height in pixels at 1x; the width is `folder.artWidth`, shared by every
shape so a row of mixed folders lines up. `radius` is the body's `border-radius`. `offsetTop`
pushes a short shape down so its optical centre sits level with its taller neighbours - the
bundled capsule uses 24. `tab` adds a tab above the body, as on a physical folder, and the body's
top-left corner is usually squared off to meet it. Omit any of them and the shape falls back to a
plain 152px body with 28px corners.

Labels stay aligned across shapes whatever the heights, because the artwork sits in a fixed slot
sized by `folder.artHeightMax` + `folder.tabSlot`. A shape taller than that slot overflows
downwards rather than dragging its label up into the artwork - so raise those two together if a
theme wants taller folders.

`asset` is still required: it is the thumbnail the folder editor's shape picker shows, and it can
depict a silhouette the geometry could not express.

**The geometry is validated, and `radius` strictly.** Sizes must be plain numbers from 0 to 1024 -
a 40,000px shape would push every other item off the desktop with no way back but editing the
database. `radius` may contain lengths, percentages, `/` and spaces only: no parentheses, so no
`url()`, `var()` or `calc()`, and no `;`, `:` or `}`. That is not fussiness - the value is written
into a `style` attribute, and `layout.json` comes from a shared theme, so anything able to close
one declaration and open another is an injection (docs/RISKS.md R5). A field that fails is
dropped and the shape keeps rendering with the default for it; the theme still loads.

### Fonts and other files referenced from theme.css

A theme can bundle a font and point at it with a **relative** path:

```css
@font-face {
  font-family: 'Manrope';
  font-weight: 200 800;
  src: url('assets/fonts/Manrope-latin.woff2') format('woff2');
}
```

Relative is the only form that works, and the only form that validates. An absolute path or one
containing `..` is refused outright - a shared theme must not be able to name a file elsewhere on
the machine (RISKS.md R5) - while a path that simply does not exist is a warning, since the rule
still applies and the browser falls back to the next family in the stack.

The shell rewrites those URLs as it injects the stylesheet (`src/theme/assets.ts`). It has to:
`theme.css` is injected as a `<style>` element, so the browser would otherwise resolve
`assets/fonts/...` against the page rather than the theme folder, and the font would quietly never
load. `data:`, `https:`, `asset:` and `#fragment` URLs are left exactly as written - though a
remote one is blocked by the app's CSP, and the shell is expected to work offline, so bundle the
file.

## layout.json

```json
{
  "regions": ["background", "desktop", "taskbar", "windows", "overlay"],
  "navBar": { "position": "top", "items": ["home", "games", "apps", "files", "media", "settings"] },
  "desktop": { "grid": { "cell": 96, "gap": 16, "snap": true } },
  "folderShapes": [{ "id": "rounded", "asset": "assets/folders/rounded.svg" }],
  "home": {
    "rows": [
      { "id": "recent", "title": "Recently played", "filter": { "sort": "last_played", "limit": 12 } },
      { "id": "favourites", "title": "Favourites", "filter": { "favouritesOnly": true } },
      { "id": "games", "title": "All games", "filter": { "type": "game" } }
    ]
  },
  "background": { "kind": "shader", "id": "aurora" },
  "fallbackBackground": { "kind": "image", "path": "assets/wallpapers/aurora.svg" }
}
```

`home.rows` is the useful one: a theme decides which shelves exist, what they are called and how
they are filled, without a code change. `filter` is an `EntryFilter` (see [IPC.md](IPC.md)).

`background` accepts the same shapes as the wallpaper setting: `{kind:"shader",id}`,
`{kind:"image",path}`, `{kind:"video",path}` or `{kind:"color",hex}`. `fallbackBackground`
is used when the primary cannot render - no WebGL2, a shader that will not compile.

### desktop

```jsonc
"desktop": {
  "grid": { "cell": 96, "gap": 16, "snap": true },
  "defaultItems": [
    { "kind": "folder", "folder": "smart:games", "x": 0, "y": 0 }
  ]
}
```

`grid` is the fallback for a desktop that has no grid settings of its own; the user's own
settings win. **`cell` and `gap` are logical pixels, but item positions are grid cells** - which
is why changing `cell` re-scales the whole arrangement instead of scattering it.

`defaultItems` is what a first run lays down. Items address a folder by its **locator**
(`smart:games`, `collection:<id>`, or a filesystem path), not by id, because ids are generated
per install and a theme cannot know them.

### folderShapes

```jsonc
"folderShapes": [
  { "id": "rounded", "asset": "assets/folders/rounded.svg" },
  { "id": "capsule", "asset": "assets/folders/capsule.svg" },
  { "id": "tab",     "asset": "assets/folders/tab.svg" }
]
```

The shapes the folder editor offers. The picker enumerates whatever the active theme declares -
there is no built-in list - so a theme can ship one shape or twenty.

Each SVG is used as a **mask**, not an image: the folder's colour tints it. Ship a flat
silhouette, not a coloured illustration, or the tint will have nothing to do. A folder whose
shape id the current theme does not declare falls back to a plain rounded plate rather than
disappearing, so switching themes never leaves a hole.

`id` must be kebab-case, and `asset` obeys the same path rules as every other reference
(relative, no `..`, must exist inside the package). An entry that breaks them is **dropped with
a warning** rather than failing the theme - `npm run theme:validate` reports it as an error so
you catch it before shipping. layout.json is handed to the UI verbatim, so this is a real
path-traversal surface once themes are shared; see [RISKS.md](RISKS.md) R5.

**A theme cannot play audio.** A video wallpaper is always silent, and there is no music or
soundtrack slot anywhere in a theme package - the five sounds below are short interface blips and
nothing else. A `"muted"` key on a video background is ignored rather than rejected, so a theme
written against an older version of this document still loads.

## theme.css

Injected after `base.css` and `shell.css`, so it wins without `!important`.

Use tokens, not literals. A hard-coded `#6ee7ff` cannot follow the user's accent override.

These class names are the stable contract:

| Hook | Is |
| --- | --- |
| `.aura-root` | The whole frame; `data-screen` is the active screen |
| `.aura-nav`, `.aura-nav-item` | The nav bar; `data-active` marks the current screen |
| `.aura-tile`, `.aura-tile-art`, `.aura-tile-label` | A library tile |
| `.aura-hero`, `.aura-hero-title` | The hero panel |
| `.aura-desktop`, `.aura-desktop-cell` | The desktop surface and one item's cell |
| `.aura-window` | A window; `data-focused` and `data-mode` (normal/maximised) |
| `.aura-window-title`, `.aura-window-name`, `.aura-window-control` | Its title bar and buttons |
| `.aura-window-body` | The window's content area |
| `.aura-window-snap-preview` | Where a dragged window would land |
| `.aura-folder`, `.aura-folder-row`, `.aura-folder-tool` | A folder window's body; `data-layout` is grid/list/covers |
| `.aura-taskbar`, `.aura-taskbar-button`, `.aura-taskbar-clock` | The taskbar; `data-position` and `data-align` on the bar, `data-running` and `data-active` on buttons |
| `.aura-settings-app`, `.aura-settings-category`, `.aura-setting` | The Settings app |
| `.aura-editor`, `.aura-choice` | The folder editor and its option buttons; `data-active` marks the current choice |
| `.aura-titlebar`, `.aura-titlebar-control` | The shell's own title bar, drawn only when windowed; `data-danger` marks close |
| `.aura-overlay`, `.aura-panel` | Modal overlays |
| `.aura-toast` | A toast; `data-level` is info/warning/error |

`[data-focused]` marks whatever the focus engine currently has. `--accent-bleed` carries the
focused item's dominant colour and is what the glow and background wash are built from.

Keep motion to `transform`, `opacity` and `filter` - they stay on the compositor. Animating
`width` or `top` will cost the 60 fps the whole product is built around.

## sounds/

Five slots and no more: `move`, `select`, `back`, `launch`, `error`. WAV or anything the webview
decodes. These are the app's **only** audio - a theme has no music, soundtrack or ambience slot,
and a file dropped anywhere else in the package is never played.

`move` plays on **every** focus change. Keep it under ~80 ms and soft; anything sharp becomes
intolerable within a minute of use. A long file in one of these slots is not a way to ship a
soundtrack: each is fired per interaction and overlapped, so anything but a blip sounds broken.
`scripts/generate-sounds.mjs` synthesises the default set and is a reasonable starting point.

## shaders/

GLSL ES 3.00 fragment shaders (WebGL2). Start with `#version 300 es`, declare
`precision highp float;` and write to your own `out vec4`.

Uniforms set every frame:

| Uniform | |
| --- | --- |
| `float u_time` | Seconds since the background mounted |
| `vec2 u_resolution` | Drawing buffer size in pixels |
| `vec3 u_accent` | Accent colour, 0..1. Zero when unset - fall back to your own |
| `vec2 u_mouse` | Pointer position, GL origin (bottom-left) |

Budget: this runs behind everything, forever, on laptops. The device pixel ratio is capped at 1.5
and the loop pauses under reduced motion, but a shader that costs 8 ms a frame is still a shader
that halves someone's battery life. `themes/aura-default/shaders/aurora.frag` is a worked
example: 4-octave value noise, three ridges, a vignette and a 1-LSB dither to stop the dark
ground banding.

A shader that fails to compile is logged and skipped - the flat themed ground shows instead.

## Legal

Themes "inspired by" a console UI are fine. Shipping Sony, Microsoft or Nintendo icons, fonts,
sounds, wave shaders or trademarks is not. Commission or make original art that captures the
feel. See PLAN.md section 02, point 5.
