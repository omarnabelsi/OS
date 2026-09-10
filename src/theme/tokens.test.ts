import { describe, expect, it } from 'vitest';

import realTokens from '../../themes/aura-default/tokens.json';
import type { ThemeTokens } from '@/bridge';
import {
  DEFAULT_TILE_FOCUS_SCALE,
  cssVariables,
  flattenTokens,
  focusScaleFrom,
  kebab,
  tileWidthFor,
} from './tokens';

describe('kebab', () => {
  it('converts camelCase token keys', () => {
    expect(kebab('accent')).toBe('accent');
    expect(kebab('surfaceStrong')).toBe('surface-strong');
    expect(kebab('accentContrast')).toBe('accent-contrast');
    expect(kebab('focusScale')).toBe('focus-scale');
    expect(kebab('widthMedium')).toBe('width-medium');
    expect(kebab('already-kebab')).toBe('already-kebab');
    expect(kebab('snake_case')).toBe('snake-case');
  });
});

describe('flattenTokens', () => {
  it('flattens groups into custom properties', () => {
    const vars = flattenTokens({
      color: { accent: '#6ee7ff', surfaceStrong: 'rgba(255,255,255,0.12)' },
      radius: { sm: '8px' },
    });
    expect(vars['--color-accent']).toBe('#6ee7ff');
    expect(vars['--color-surface-strong']).toBe('rgba(255,255,255,0.12)');
    expect(vars['--radius-sm']).toBe('8px');
  });

  it('keeps unitless numbers unitless', () => {
    const vars = flattenTokens({ tile: { focusScale: 1.08, widthSmall: 160 } });
    expect(vars['--tile-focus-scale']).toBe('1.08');
    expect(vars['--tile-width-small']).toBe('160');
  });

  it('survives junk without throwing', () => {
    expect(flattenTokens(null)).toEqual({});
    expect(flattenTokens(undefined)).toEqual({});
    expect(flattenTokens({} as ThemeTokens)).toEqual({});
    // Nested objects and nulls are skipped rather than stringified to "[object Object]".
    const vars = flattenTokens({
      color: { accent: '#fff', nested: { deep: 'x' }, missing: null },
    } as unknown as ThemeTokens);
    expect(vars).toEqual({ '--color-accent': '#fff' });
  });

  it('flattens the real aura-default token file', () => {
    const vars = flattenTokens(realTokens as ThemeTokens);
    // These are the properties src/styles/base.css declares as fallbacks; if a rename ever
    // breaks the mapping, the whole UI loses its colours, so pin the important ones.
    for (const name of [
      '--color-background',
      '--color-surface',
      '--color-surface-strong',
      '--color-text',
      '--color-text-muted',
      '--color-accent',
      '--color-accent-contrast',
      '--color-focus-ring',
      '--color-danger',
      '--radius-tile',
      '--blur-background',
      '--spacing-edge',
      '--easing-standard',
      '--duration-base',
      '--tile-width',
      '--tile-aspect',
      '--tile-focus-scale',
      '--font-ui',
    ]) {
      expect(vars[name], `${name} must be produced by the theme`).toBeTruthy();
    }
  });
});

describe('tileWidthFor', () => {
  const vars = flattenTokens(realTokens as ThemeTokens);

  it('picks the size-specific width and adds px to bare numbers', () => {
    expect(tileWidthFor(vars, 'small')).toBe('160px');
    expect(tileWidthFor(vars, 'medium')).toBe('220px');
    expect(tileWidthFor(vars, 'large')).toBe('300px');
  });

  it('falls back to the base width when a theme omits the variants', () => {
    const sparse = flattenTokens({ tile: { width: '200px' } });
    expect(tileWidthFor(sparse, 'large')).toBe('200px');
    expect(tileWidthFor({}, 'large')).toBeNull();
  });

  it('leaves values that already carry a unit alone', () => {
    const withUnits = flattenTokens({ tile: { widthLarge: '18rem' } });
    expect(tileWidthFor(withUnits, 'large')).toBe('18rem');
  });
});

describe('focusScaleFrom', () => {
  it('reads the real theme token rather than a hard-coded literal', () => {
    // The whole point: Tile.tsx and the CSS that reserves room for the scaled tile must agree,
    // so both read this. If a theme raises focusScale, the spacing follows.
    expect(focusScaleFrom(realTokens as ThemeTokens)).toBe(1.08);
    expect(focusScaleFrom({ tile: { focusScale: 1.2 } })).toBe(1.2);
    expect(focusScaleFrom({ tile: { focusScale: '1.15' } })).toBe(1.15);
  });

  it('falls back rather than letting a theme break the layout', () => {
    for (const junk of [undefined, null, {}, { tile: {} }, { tile: { focusScale: 'huge' } }]) {
      expect(focusScaleFrom(junk as ThemeTokens)).toBe(DEFAULT_TILE_FOCUS_SCALE);
    }
    // Out of range in either direction: a 4x tile would cover its neighbours.
    expect(focusScaleFrom({ tile: { focusScale: 4 } })).toBe(DEFAULT_TILE_FOCUS_SCALE);
    expect(focusScaleFrom({ tile: { focusScale: 0.2 } })).toBe(DEFAULT_TILE_FOCUS_SCALE);
  });
});

describe('cssVariables', () => {
  const base = { tileSize: 'medium' as const, uiScale: 1, accentColor: null };

  it('applies the chosen tile size to --tile-width, scaled by the UI scale', () => {
    const vars = cssVariables(realTokens as ThemeTokens, { ...base, tileSize: 'large' });
    // Left as a calc() so it tracks --ui-scale live: text is sized in rem and follows the root
    // font-size, so a fixed-px tile would carry a caption far too large for it at 2x.
    expect(vars['--tile-width']).toBe('calc(300px * var(--ui-scale))');
  });

  it('lets the user override the accent colour', () => {
    const themed = cssVariables(realTokens as ThemeTokens, base);
    expect(themed['--color-accent']).toBe('#6ee7ff');

    const overridden = cssVariables(realTokens as ThemeTokens, { ...base, accentColor: '#ff00aa' });
    expect(overridden['--color-accent']).toBe('#ff00aa');
  });

  it('clamps ui scale into a usable range', () => {
    expect(cssVariables(null, { ...base, uiScale: 1.25 })['--ui-scale']).toBe('1.25');
    expect(cssVariables(null, { ...base, uiScale: 9 })['--ui-scale']).toBe('2');
    expect(cssVariables(null, { ...base, uiScale: 0.1 })['--ui-scale']).toBe('0.5');
    expect(cssVariables(null, { ...base, uiScale: 0 })['--ui-scale']).toBe('1');
    expect(cssVariables(null, { ...base, uiScale: NaN })['--ui-scale']).toBe('1');
  });

  it('works with no theme at all', () => {
    const vars = cssVariables(null, base);
    expect(vars['--ui-scale']).toBe('1');
    expect(vars['--color-accent']).toBeUndefined();
  });
});
