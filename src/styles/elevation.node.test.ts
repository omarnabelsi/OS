/**
 * Elevation stays in the ladder.
 *
 * The acceptance criterion for the ladder is "no ad-hoc box-shadow remains", and the only way
 * that holds past the week it was written is if something checks. A drop shadow written by hand
 * is depth nobody budgeted for; a `backdrop-filter` written by hand is a blurred surface the
 * budget cannot see, which is the exact failure the budget exists to prevent.
 *
 * Hairlines are not elevation and are allowed: `inset` strokes, focus rings, and the 1px line
 * along a docked taskbar edge. The rule below is about *drop* shadows.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const STYLES = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(STYLES, name), 'utf8');

const SHELL = read('shell.css');
const ELEVATION = read('elevation.css');

/** Every `box-shadow: ...;` value in a stylesheet, whitespace collapsed. */
function shadows(css: string): string[] {
  return [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => (m[1] ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * A value that raises the element off the page, rather than drawing a line on it.
 *
 * A hairline is `inset`, or has no blur radius worth the name - `0 1px 0 <colour>`. Anything
 * with a real blur radius is a drop shadow and belongs to a level.
 */
function isDropShadow(value: string): boolean {
  return value
    .split(/,(?![^(]*\))/)
    .some((layer) => {
      const part = layer.trim();
      if (part === '' || part.startsWith('inset') || part.startsWith('var(--elevation')) return false;
      const lengths = [...part.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      // offset-x, offset-y, blur - a hairline has no third length, or a zero one.
      return (lengths[2] ?? 0) > 2;
    });
}

describe('the elevation ladder', () => {
  it('owns every drop shadow', () => {
    const offenders = shadows(SHELL).filter(isDropShadow);
    expect(offenders).toEqual([]);
  });

  it('still lets a taskbar edge draw its hairline alongside the level shadow', () => {
    // Composed, not replaced: a more specific `box-shadow` would silently drop e2's depth.
    expect(SHELL).toContain('box-shadow: var(--elevation-e2-shadow), 0 1px 0 var(--color-surface-strong);');
  });

  it('is the only place a backdrop-filter is written', () => {
    // One exception, and it is deliberate: the rule that turns the small decorative blurs *off*
    // when a theme says `blur.surface: 0`.
    const inShell = [...SHELL.matchAll(/backdrop-filter:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(inShell.filter((value) => value !== 'none')).toEqual([]);
  });

  it('defines all five levels', () => {
    for (const level of ['e0', 'e1', 'e2', 'e3', 'e4']) {
      expect(ELEVATION).toContain(`.aura-surface-${level} {`);
    }
  });

  it('paints each of the three blur states', () => {
    for (const state of ['live', 'snapshot', 'off']) {
      expect(ELEVATION).toContain(`.aura-surface[data-blur='${state}']`);
    }
  });

  it('reads its shadows, tints and blurs from tokens', () => {
    // A literal colour here would be a level a theme cannot restyle.
    const levelBlock = ELEVATION.slice(
      ELEVATION.indexOf('.aura-surface-e1 {'),
      ELEVATION.indexOf('.aura-surface-scrim'),
    );
    expect(levelBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(levelBlock).not.toMatch(/rgba?\(/);
  });
});
