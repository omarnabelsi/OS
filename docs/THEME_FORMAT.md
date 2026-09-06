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
| `radius` | `sm` `md` `lg` `tile` |
| `blur` | `background` `surface` |
| `spacing` | `edge` `gutter` `row` |
| `easing` | `standard` `emphasized` |
| `duration` | `fast` `base` `slow` |
| `tile` | `width` `aspect` `focusScale` `gap` `widthSmall` `widthMedium` `widthLarge` |
| `font` | `ui` `display` |

`tile.widthSmall/Medium/Large` back the tile-size setting: the chosen one is written to
`--tile-width`. Bare numbers get `px` appended.

`duration.*` is how a theme participates in reduced motion - the shell collapses all three to
`0ms` when the user asks for it, so motion built on those tokens stops for free.

## layout.json

```json
{
  "regions": ["background", "navBar", "hero", "tiles", "overlay"],
  "navBar": { "position": "top", "items": ["home", "games", "apps", "files", "media", "settings"] },
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
`{kind:"image",path}`, `{kind:"video",path,muted}` or `{kind:"color",hex}`. `fallbackBackground`
is used when the primary cannot render - no WebGL2, a shader that will not compile.

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
| `.aura-overlay`, `.aura-panel` | Modal overlays |
| `.aura-toast` | A toast; `data-level` is info/warning/error |

`[data-focused]` marks whatever the focus engine currently has. `--accent-bleed` carries the
focused item's dominant colour and is what the glow and background wash are built from.

Keep motion to `transform`, `opacity` and `filter` - they stay on the compositor. Animating
`width` or `top` will cost the 60 fps the whole product is built around.

## sounds/

Five slots: `move`, `select`, `back`, `launch`, `error`. WAV or anything the webview decodes.

`move` plays on **every** focus change. Keep it under ~80 ms and soft; anything sharp becomes
intolerable within a minute of use. `scripts/generate-sounds.mjs` synthesises the default set and
is a reasonable starting point.

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
