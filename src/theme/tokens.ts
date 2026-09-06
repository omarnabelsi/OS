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
 * Flatten to `{ '--color-accent': '#6ee7ff', ... }`.
 * Numbers are stringified as-is: unitless tokens like `tile.focusScale` must stay unitless.
 */
export function flattenTokens(tokens: ThemeTokens | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tokens || typeof tokens !== 'object') return out;

  for (const [group, values] of Object.entries(tokens)) {
    if (!values || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      out[`--${kebab(group)}-${kebab(key)}`] = String(value);
    }
  }
  return out;
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

  const width = tileWidthFor(vars, overrides.tileSize);
  if (width) vars['--tile-width'] = width;

  if (overrides.accentColor) vars['--color-accent'] = overrides.accentColor;

  // Clamped defensively: settings validation also enforces this range, but a theme or a stale
  // stored value must never be able to render the UI unusable.
  vars['--ui-scale'] = String(Math.min(2, Math.max(0.5, overrides.uiScale || 1)));

  return vars;
}
