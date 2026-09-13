/**
 * Design tokens -> CSS custom properties.
 *
 * `tokens.json` is a two-level object (`group.key`); the UI consumes flat custom properties
 * (`--group-key`). Keeping the conversion here, pure and tested, means a theme author can add a
 * token and use it from `theme.css` without touching any component.
 */

import type { ThemeTokens, TileSize } from '@/bridge';

/** `surfaceStrong` -> `surface-strong`, so JSON stays camelCase and CSS stays kebab-case. */
export function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * How deep a token path may nest. `font.weight.label` is three, and nothing the format defines
 * goes deeper; the cap is here so a malformed or hostile theme cannot walk forever.
 */
const MAX_TOKEN_DEPTH = 4;

/**
 * Flatten to `{ '--color-accent': '#6ee7ff', ... }`.
 *
 * Nested groups join with dashes, so `font.weight.label` becomes `--font-weight-label` and
 * `elevation.e1.shadow` becomes `--elevation-e1-shadow`. This used to walk exactly two levels,
 * which silently dropped anything deeper - a theme could set `font.weight.label` and watch
 * nothing happen.
 *
 * Numbers are stringified as-is: unitless tokens like `tile.focusScale` must stay unitless.
 */
export function flattenTokens(tokens: ThemeTokens | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tokens || typeof tokens !== 'object') return out;

  const walk = (value: unknown, path: string[]): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      // A bare value at the top level is not a token: every property is `group.key` at least.
      if (path.length >= 2) out[`--${path.map(kebab).join('-')}`] = String(value);
      return;
    }
    if (typeof value !== 'object' || Array.isArray(value)) return;
    if (path.length >= MAX_TOKEN_DEPTH) return;
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
  };

  for (const [group, values] of Object.entries(tokens)) walk(values, [group]);
  return out;
}

/** Matches the `--tile-focus-scale` fallback in base.css, for when a theme declares none. */
export const DEFAULT_TILE_FOCUS_SCALE = 1.08;

/**
 * How far a focused tile scales up, from `tile.focusScale`.
 *
 * Read from the token rather than hard-coded in `Tile.tsx`, because the CSS that reserves room
 * for the enlarged tile (`--tile-focus-bleed` in shell.css) is derived from the same number. If
 * the two ever disagree the label gets covered by the artwork, which is exactly the bug this
 * exists to prevent. A value outside a sane range falls back instead of breaking the layout.
 */
export function focusScaleFrom(tokens: ThemeTokens | null | undefined): number {
  const raw = tokens?.tile?.focusScale;
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 1.5
    ? parsed
    : DEFAULT_TILE_FOCUS_SCALE;
}

/** Pixel width for the user's tile-size preference, falling back to the theme's base width. */
export function tileWidthFor(vars: Record<string, string>, size: TileSize): string | null {
  const named = vars[`--tile-width-${size}`];
  if (named) return /^\d+(\.\d+)?$/.test(named) ? `${named}px` : named;
  return vars['--tile-width'] ?? null;
}

export interface RuntimeOverrides {
  tileSize: TileSize;
  uiScale: number;
  /** Hex colour replacing the theme accent, or null to keep the theme's own. */
  accentColor: string | null;
  /** 0.8 - 1.3. A fine-tune multiplier layered on top of `tileSize` and `uiScale`. */
  tileScale: number;
  /** 0.7 - 1.5. Scales the taskbar's own dimensions, independent of `uiScale`. */
  taskbarScale: number;
}

/** `#6ee7ff` -> relative luminance, the WCAG way (sRGB, linearised, Rec. 709 weights). */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/**
 * Ink for text sitting on a filled `accentHex` surface (the one filled chip): near-black or
 * white, whichever the accent contrasts better against.
 *
 * A picked accent is arbitrary, so the theme's own `accentContrast` cannot be assumed to still
 * read - a light preset over a dark theme's near-black `accentContrast` would be nearly invisible.
 */
export function contrastInkFor(accentHex: string): string {
  const luminance = relativeLuminance(accentHex);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack >= contrastWithWhite ? '#0b0d12' : '#ffffff';
}

/**
 * The complete custom-property set to write onto the root element: theme tokens first, then the
 * handful of values the user controls at runtime.
 */
export function cssVariables(
  tokens: ThemeTokens | null | undefined,
  overrides: RuntimeOverrides,
): Record<string, string> {
  const vars = flattenTokens(tokens);

  if (overrides.accentColor) {
    vars['--color-accent'] = overrides.accentColor;
    // The theme's own `accentContrast` was picked for the theme's own accent - a user-chosen
    // accent needs its own ink, derived rather than assumed, or the one filled chip can end up
    // unreadable.
    vars['--color-accent-contrast'] = contrastInkFor(overrides.accentColor);
  }

  // Clamped defensively: settings validation also enforces this range, but a theme or a stale
  // stored value must never be able to render the UI unusable.
  const scale = Math.min(2, Math.max(0.5, overrides.uiScale || 1));
  vars['--ui-scale'] = String(scale);

  const tileScale = Math.min(1.3, Math.max(0.8, overrides.tileScale || 1));
  vars['--tile-scale'] = String(tileScale);

  // Tiles scale with the UI too. Text is sized in `rem`, which follows `--ui-scale` through the
  // root font-size (base.css), so a fixed-px tile would end up with a caption far too big for
  // it at 2x. The separate "Tile size" setting is what changes tiles independently, and
  // `--tile-scale` is a further fine-tune on top of both.
  const width = tileWidthFor(vars, overrides.tileSize);
  if (width) vars['--tile-width'] = `calc(${width} * var(--ui-scale) * var(--tile-scale))`;

  /*
   * The desktop folder's own artwork, not just tiles inside an opened folder - "tile scale" reads
   * as "folder size" from the desktop, which is what it must actually change. Width and the two
   * slot-reservation tokens (`--folder-art-height-max`, `--folder-tab-slot`, which
   * `--folder-art-slot` in folder.css adds together to reserve room for every shape's label) scale
   * here at the root; `Folder.tsx` scales its own per-shape height/offset/tab pixels by the same
   * `--tile-scale` so a folder never outgrows the slot this reserves for it.
   */
  for (const key of ['--folder-art-width', '--folder-art-height-max', '--folder-tab-slot', '--folder-icon-size']) {
    if (vars[key]) vars[key] = `calc(${vars[key]} * var(--tile-scale))`;
  }

  /*
   * The desktop grid cell itself, or a bigger folder would just overflow the same fixed-size slot
   * it used to fit - `.aura-folder`'s own box is `width: 100%` of its grid cell, not the art's own
   * width, so scaling the art alone leaves the folder's clickable footprint unchanged (too small
   * to hold a grown folder, wastefully large around a shrunk one). `DesktopSurface.tsx` measures
   * these two plus the gaps as the grid's stride - through `Number.parseFloat`, not CSS, so unlike
   * every other override above this one must resolve to a plain pixel number here, not a `calc()`
   * string a JS parseFloat would choke on.
   */
  for (const key of [
    '--desktop-grid-cell-w',
    '--desktop-grid-cell-h',
    '--desktop-column-gap',
    '--desktop-row-gap',
  ]) {
    const px = Number.parseFloat(vars[key] ?? '');
    if (Number.isFinite(px)) vars[key] = `${Math.round(px * tileScale * 10) / 10}px`;
  }

  // The taskbar's own size, independent of `--ui-scale` - a bigger interface elsewhere should not
  // force a bigger taskbar and vice versa. Only the "how big does it look" tokens scale; the
  // corner radius and the margin that detaches it from the screen edge stay fixed on purpose.
  const taskbarScale = Math.min(1.5, Math.max(0.7, overrides.taskbarScale || 1));
  vars['--taskbar-scale'] = String(taskbarScale);
  for (const key of [
    '--taskbar-height',
    '--taskbar-icon-size',
    '--taskbar-size',
    '--taskbar-gap',
    '--taskbar-padding',
  ]) {
    if (vars[key]) vars[key] = `calc(${vars[key]} * var(--taskbar-scale))`;
  }

  return vars;
}
