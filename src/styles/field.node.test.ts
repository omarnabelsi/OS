/**
 * The field's motion, as written in CSS.
 *
 * Three things here are load-bearing and easy to break by tidying:
 *  - the two drift periods must not be multiples of each other, or the field visibly loops;
 *  - the grain must not intercept a pointer, because it covers the screen;
 *  - reduced motion must stop the drift without removing the field.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FIELD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'field.css'), 'utf8');

/** Seconds of each `animation:` shorthand in the file. */
function periods(css: string): number[] {
  return [...css.matchAll(/animation:[^;]*?(\d+(?:\.\d+)?)s/g)].map((m) => Number(m[1]));
}

describe('the aurora field', () => {
  it('drifts on two periods that do not line up', () => {
    const found = periods(FIELD).sort((a, b) => a - b);
    expect(found).toEqual([68, 104]);

    // Each layer alternates, so a layer repeats every 2x its period. The combined pattern
    // returns only at the least common multiple of those - which has to be far longer than
    // anyone looks at it for.
    const [fast, slow] = [136, 208];
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const loopSeconds = (fast * slow) / gcd(fast, slow);
    expect(loopSeconds).toBeGreaterThan(30 * 60);
  });

  it('never lets the grain take a click', () => {
    const grain = FIELD.slice(FIELD.indexOf('.aura-field-grain {'));
    expect(grain.slice(0, grain.indexOf('}'))).toContain('pointer-events: none');
  });

  it('puts the grain at the opacity the design asks for', () => {
    expect(FIELD).toMatch(/opacity:\s*0?\.055/);
    expect(FIELD).toContain('mix-blend-mode: overlay');
  });

  it('freezes the drift for reduced motion, both ways of asking', () => {
    expect(FIELD).toContain('@media (prefers-reduced-motion: reduce)');
    expect(FIELD).toContain(':root[data-reduce-motion] .aura-field-primary');
    // Two `animation: none` - one per way of asking - and neither removes the gradient.
    expect([...FIELD.matchAll(/animation: none;/g)]).toHaveLength(2);
    expect(FIELD).not.toMatch(/background-image:\s*none/);
  });

  it('takes its colours from tokens so a theme can restyle the field', () => {
    for (const token of ['--aurora-1', '--aurora-2', '--aurora-3', '--aurora-4', '--aurora-5', '--aurora-6']) {
      expect(FIELD).toContain(`var(${token})`);
    }
  });

  it('drifts on the compositor rather than repainting gradients', () => {
    // `background-position` on four full-screen radials is a repaint every frame; that cost is
    // the whole reason the elevation ladder is shadow-heavy, so the field must not spend it.
    expect(FIELD).not.toMatch(/animation[^;]*background-position/);
    expect(FIELD).toMatch(/@keyframes aura-field-drift\b[\s\S]*?transform: translate3d/);
  });
});
