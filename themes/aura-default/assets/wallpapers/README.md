# Wallpapers

`aurora.svg` is the theme's static fallback background: 1920x1080, pure vector (gradients plus
soft blurred ellipses, no raster data). `layout.json` points at it through `fallbackBackground`;
the primary background is the `aurora` shader in `../../shaders/`.

No video wallpaper is bundled with this theme. No video encoder is available at build time, and a
looping clip of acceptable quality would add tens of megabytes to the package. Any `.mp4` or
`.webm` picked in **Settings > Wallpaper** works as a looping video background (WebView2 decodes
H.264 / VP9 / AV1 in hardware).

A theme that wants to ship its own clip can drop it in this folder and set

```json
"background": { "kind": "video", "path": "assets/wallpapers/<file>.webm", "muted": true }
```

in its `layout.json`. Keep the static image as `fallbackBackground` so first paint is instant.
