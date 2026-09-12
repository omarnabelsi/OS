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

const ELEVATION = read('elevation.css');

/**
 * Every stylesheet that draws a raised thing.
 *
 * Checked together rather than just `shell.css`: the folder, the desktop and the taskbar all got
 * their own files, and a rule that escapes the ladder is exactly as much of a problem in one of
 * those as in the original.
 */
const SHEETS = ['shell.css', 'folder.css', 'desktop.css', 'taskbar.css', 'window.css'] as const;
const COMPONENT_CSS = SHEETS.map(read).join('\n');
const TASKBAR = read('taskbar.css');

/** Every `box-shadow: ...;` value in a stylesheet, whitespace collapsed. */
function shadows(css: string): string[] {
  return [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => (m[1] ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * A value that raises the element off the page, rather than drawing on it or glowing.
 *
 * Three things are allowed and are not elevation:
 *  - `inset` strokes and focus rings, which are lines drawn *inside* the box;
 *  - a hairline, which has no blur radius worth the name (`0 1px 0 <colour>`);
 *  - a glow, which has no offset at all (`0 0 38px`) - a bloom around a focused thing is light,
 *    not height, and the design asks for one on both the folder and the taskbar plate.
 *
 * A value that mentions an elevation token is on the ladder by definition, including when it
 * composes something else alongside it - which is how the focus bloom keeps its level's shadow.
 */
function isDropShadow(value: string): boolean {
  if (value.includes('var(--elevation')) return false;
  return value.split(/,(?![^(]*\))/).some((layer) => {
    const part = layer.trim();
    if (part === '' || part.startsWith('inset')) return false;
    const lengths = [...part.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
    const [offsetX = 0, offsetY = 0, blur = 0] = lengths;
    if (blur <= 2) return false;
    return offsetX !== 0 || offsetY !== 0;
  });
}

describe('the elevation ladder', () => {
  it('owns every drop shadow', () => {
    const offenders = shadows(COMPONENT_CSS).filter(isDropShadow);
    expect(offenders).toEqual([]);
  });

  it('lets a focus bloom compose with the level shadow instead of replacing it', () => {
    // A bare `box-shadow` on the focused folder would out-specify `.aura-surface-e3` and
    // silently drop the lift that focus had just earned.
    expect(read('folder.css')).toContain('box-shadow: var(--elevation-e3-shadow), 0 0 38px');
  });

  it('gives the detached taskbar no shadow of its own', () => {
    // It is a floating pill with no docked edge, so its depth is entirely level e2's. The old
    // per-edge hairlines went with the dock they belonged to.
    expect(shadows(TASKBAR).filter(isDropShadow)).toEqual([]);
    expect(TASKBAR).not.toContain('--elevation-e2-shadow');
  });

  it('is the only place a backdrop-filter is written', () => {
    // The components get their blur from the ladder, which is what lets the budget refuse it.
    const written = [...COMPONENT_CSS.matchAll(/backdrop-filter:\s*([^;]+);/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(written.filter((value) => value !== 'none')).toEqual([]);
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
