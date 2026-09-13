/**
 * What every bundled theme has to be, whatever it looks like.
 *
 * The design separates *structure* from *theme*: the 2:3 tile, the label below the artwork, the
 * four focus signals, the e0-e4 ladder, the three folder shapes, the detached taskbar and the
 * contrast floors are not a theme's decisions. A theme picks colour, radius, blur, spacing and
 * type - and if a theme can only look right by touching a component, the architecture has
 * regressed, not the theme.
 *
 * So this reads the shipped token files and holds all of them to the structural rules, and to the
 * contrast floors in particular: 4.5:1 for body text, 3:1 for display. Checked, never assumed -
 * a light theme is exactly where a palette chosen by eye stops being legible.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEMES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'themes');

const names = readdirSync(THEMES).filter((name) => statSync(join(THEMES, name)).isDirectory());

interface Theme {
  name: string;
  manifest: Record<string, unknown>;
  tokens: Record<string, Record<string, unknown>>;
  layout: Record<string, unknown>;
  hasCssFile: boolean;
}

const themes: Theme[] = names.map((name) => {
  const read = (file: string): Record<string, never> => {
    const path = join(THEMES, name, file);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  };
  return {
    name,
    manifest: read('manifest.json'),
    tokens: read('tokens.json'),
    layout: read('layout.json'),
    hasCssFile: existsSync(join(THEMES, name, 'theme.css')),
  };
});

/** Themes added as the acceptance test for the design system: tokens and assets, no CSS at all. */
const TOKENS_ONLY = ['aura-ember', 'aura-daylight'];

// ---- colour -------------------------------------------------------------------------------------

type Rgb = [number, number, number];

/** `#abc`, `#aabbcc`, `rgb(...)` or `rgba(...)` as [r, g, b, a]. */
function parseColour(value: string): [number, number, number, number] {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
    const n = Number.parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const parts = fn[1]!.split(/[,/]/).map((p) => Number.parseFloat(p.trim()));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  }
  throw new Error(`cannot read colour \`${value}\``);
}

/** Composite a possibly-translucent colour over an opaque one, the way the screen does. */
function over(colour: string, background: string): Rgb {
  const [r, g, b, a] = parseColour(colour);
  const [br, bg, bb] = parseColour(background);
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, rounded to two places so a failure message is readable. */
function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(over(foreground, background));
  const b = relativeLuminance(over(background, background));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
}

describe('every bundled theme', () => {
  it('ships at least the reference, the two proofs and paper', () => {
    expect(names).toContain('aura-default');
    expect(names).toContain('aura-paper');
    expect(names).toContain('aura-ember');
    expect(names).toContain('aura-daylight');
  });

  it.each(themes.map((t) => [t.name, t] as const))('%s meets the contrast floors', (_name, theme) => {
    const colour = theme.tokens.color as Record<string, string>;
    const background = colour.background!;

    // Body copy: 4.5:1. This is the one that decides whether the shell is readable at all.
    expect(contrast(colour.text!, background)).toBeGreaterThanOrEqual(4.5);
    // Display and metadata: 3:1. Muted ink is translucent, so it is composited first.
    expect(contrast(colour.textMuted!, background)).toBeGreaterThanOrEqual(3);
    // Dark ink on the one filled accent surface - the active chip - is body copy too.
    expect(contrast(colour.accentContrast!, colour.accent!)).toBeGreaterThanOrEqual(4.5);
    // A focus ring nobody can see is not a focus signal.
    expect(contrast(colour.focusRing!, background)).toBeGreaterThanOrEqual(3);
  });

  it.each(themes.map((t) => [t.name, t] as const))('%s keeps the structural rules', (_name, theme) => {
    const tokens = theme.tokens;

    // The tile is 2:3 with its label below - structure, not a theme's choice.
    expect((tokens.tile as Record<string, string>).aspect).toBe('2 / 3');

    // The whole ladder, so every level can be raised without glass.
    const elevation = tokens.elevation as Record<string, Record<string, string>>;
    for (const level of ['e1', 'e2', 'e3', 'e4']) {
      expect(elevation?.[level]?.shadow, `${level}.shadow`).toBeTruthy();
      expect(elevation?.[level]?.surface, `${level}.surface`).toBeTruthy();
      expect(elevation?.[level]?.blur, `${level}.blur`).toBeDefined();
    }
    expect(elevation.e4!.scrim, 'e4.scrim').toBeTruthy();

    // Four weights, so the type hierarchy survives a retheme.
    const weights = (tokens.font as Record<string, Record<string, number>>).weight;
    for (const role of ['display', 'title', 'label', 'meta', 'section']) {
      expect(weights?.[role], `font.weight.${role}`).toBeTruthy();
    }

    // A detached taskbar: the desktop has to read as continuous behind it.
    const taskbar = tokens.taskbar as Record<string, string>;
    expect(Number.parseFloat(taskbar.margin ?? taskbar.inset ?? '0')).toBeGreaterThan(0);

    // Glass without blur shows the desktop straight through a window, so the two travel together.
    const blur = Number.parseFloat((tokens.blur as Record<string, string>).surface ?? '0');
    if (blur === 0) {
      expect((tokens.window as Record<string, string>).opacity).toBe('100%');
    }
  });

  it.each(themes.map((t) => [t.name, t] as const))('%s offers three folder shapes', (_name, theme) => {
    /*
     * Three shapes is structural; *which* three is the theme's own business. `aura-paper` calls
     * its set binder / envelope / crate and is no less correct for it - the ids are per theme,
     * and a folder whose shape the active theme does not offer falls back to that theme's first.
     * What every set has to contain is the same three kinds: a plain body, one pushed down so its
     * optical centre lines up, and one wearing a tab.
     */
    const shapes = (theme.layout.folderShapes ?? []) as Array<Record<string, unknown>>;
    expect(shapes).toHaveLength(3);

    for (const shape of shapes) {
      expect(String(shape.id)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(typeof shape.height, `${shape.id}.height`).toBe('number');
      expect(typeof shape.radius, `${shape.id}.radius`).toBe('string');
      // Each theme ships its own silhouette; a theme may not reach into another theme's folder.
      expect(existsSync(join(THEMES, theme.name, String(shape.asset))), `${shape.id}.asset`).toBe(true);
    }

    const tabbed = shapes.filter((s) => s.tab);
    expect(tabbed, 'exactly one shape wears a tab').toHaveLength(1);
    const tab = tabbed[0]!.tab as Record<string, unknown>;
    expect(typeof tab.width).toBe('number');
    expect(typeof tab.height).toBe('number');
    expect(typeof tab.radius).toBe('string');

    expect(shapes.filter((s) => s.offsetTop), 'one shape is pushed down to align optically').toHaveLength(1);
  });

  it.each(TOKENS_ONLY.map((name) => [name] as const))('%s is tokens and assets only', (name) => {
    const theme = themes.find((t) => t.name === name)!;
    // The point of these two: no stylesheet at all. If either needed CSS to look right, the
    // component would be the thing to fix.
    expect(theme.hasCssFile).toBe(false);
    expect(theme.manifest.hasCss).toBe(false);
    expect(existsSync(join(THEMES, name, 'tokens.json'))).toBe(true);
  });

  it('gives each theme the field colours, so the background is themeable too', () => {
    for (const theme of themes) {
      const aurora = theme.tokens.aurora as Record<string, string> | undefined;
      for (const stop of ['1', '2', '3', '4', '5', '6']) {
        expect(aurora?.[stop], `${theme.name} aurora.${stop}`).toBeTruthy();
      }
    }
  });

  it('reports what it measured', () => {
    // Not an assertion - the numbers are the useful part of a contrast test.
    const rows = themes.map((theme) => {
      const c = theme.tokens.color as Record<string, string>;
      return `${theme.name}: body ${contrast(c.text!, c.background!)}:1, muted ${contrast(
        c.textMuted!,
        c.background!,
      )}:1, chip ${contrast(c.accentContrast!, c.accent!)}:1, ring ${contrast(c.focusRing!, c.background!)}:1`;
    });
    console.log(rows.join('\n'));
    expect(rows).toHaveLength(names.length);
  });
});
