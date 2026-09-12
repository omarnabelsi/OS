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

  if (overrides.accentColor) vars['--color-accent'] = overrides.accentColor;

  // Clamped defensively: settings validation also enforces this range, but a theme or a stale
  // stored value must never be able to render the UI unusable.
  const scale = Math.min(2, Math.max(0.5, overrides.uiScale || 1));
  vars['--ui-scale'] = String(scale);

  // Tiles scale with the UI too. Text is sized in `rem`, which follows `--ui-scale` through the
  // root font-size (base.css), so a fixed-px tile would end up with a caption far too big for
  // it at 2x. The separate "Tile size" setting is what changes tiles independently.
  const width = tileWidthFor(vars, overrides.tileSize);
  if (width) vars['--tile-width'] = `calc(${width} * var(--ui-scale))`;

  return vars;
}
