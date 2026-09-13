/**
 * The window's geometry and states, as written in CSS.
 *
 * These are the numbers the design specifies, and the kind of thing a later tidy-up silently
 * rounds off. The accent rule at the end is the one worth keeping honest: the only filled accent
 * surface in a window is the active chip, and it has to carry dark ink to be readable.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WINDOW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'window.css'), 'utf8');

/**
 * The stylesheet with its comments removed.
 *
 * Prose in this file contains braces - `<Surface blur={focused}>` for one - and a naive reader
 * treats the first of those as the end of the rule it sits in. That cost two false failures.
 */
const CSS = WINDOW.replace(/\/\*[\s\S]*?\*\//g, '');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The declarations of the rule headed by `selector`.
 *
 * Handles a selector that heads a list (`a,\nb { ... }`), which is how the two-state rules are
 * written, and returns '' when there is no such rule rather than throwing.
 */
function block(selector: string): string {
  const match = CSS.match(new RegExp(`(?:^|[},])\\s*${escapeRe(selector)}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('window chrome', () => {
  it('is a 64px title bar, padded 0 20 0 28, with a hairline under it', () => {
    const title = block('.aura-window-title');
    expect(title).toContain('height: var(--window-title-bar-height, 64px)');
    expect(title).toContain('padding: 0 20px 0 28px');
    expect(title).toMatch(/border-bottom: 1px solid var\(--window-divider/);
  });

  it('gives the frame the glass the design asks for', () => {
    const frame = block('.aura-window-frame');
    expect(frame).toContain('border-radius: var(--window-radius');
    /*
     * The hairline is an inset ring, not a `border`. A border is 2px of layout, and the design's
     * numbers leave none: a 748px window with a 64px title bar is meant to hold 684px of content,
     * and a border made that 682. Measured in the running app, not reasoned about.
     */
    expect(frame).not.toMatch(/^\s*border:/m);
    expect(frame).toMatch(/inset 0 0 0 1px var\(--window-border/);
    // The sheen rides on the ladder's own fill hook, so it survives all three blur states.
    expect(frame).toMatch(/--surface-fill: linear-gradient\(180deg, var\(--window-sheen/);
    expect(frame).toContain('transparent 38%');
    // Composed with e3, never replacing it. Whitespace-flattened: a long shadow list wraps, and
    // a test that breaks on reformatting is a test of the formatter.
    expect(frame.replace(/\s+/g, ' ')).toMatch(
      /box-shadow: var\(--elevation-e3-shadow\), inset 0 1px 0 var\(--window-inset-highlight/,
    );
  });

  it('blurs and dims the desktop behind a focused window, and scrims it', () => {
    const behind = block('.aura-main[data-window-focused] .aura-screen-slot');
    expect(behind).toContain('blur(var(--window-backdrop-blur, 7px))');
    // The dim is a `brightness` in the same filter chain, *not* `opacity`: framer-motion animates
    // the slot's opacity inline for the screen transition, and an inline style wins - so an
    // `opacity` here applied the blur and silently dropped the dim.
    expect(behind).toContain('brightness(var(--window-backdrop-dim, 0.55))');
    expect(behind).not.toMatch(/^\s*opacity:/m);
    expect(block('.aura-window-layer::before')).toMatch(
      /background: var\(--window-scrim, rgba\(4, 6, 12, 0\.52\)\)/,
    );
  });

  it('draws 40px controls with 12px corners', () => {
    const control = block('.aura-window-control');
    expect(control).toContain('width: var(--window-control-size, 40px)');
    expect(control).toContain('height: var(--window-control-size, 40px)');
    expect(control).toContain('border-radius: var(--window-control-radius, 12px)');
    expect(control).toMatch(/background: var\(--window-control-plate/);
  });

  it('rings a focused control 3px inside itself and blooms it', () => {
    const focused = block('.aura-window-control[data-focused]');
    expect(focused).toContain('outline: 3px solid var(--color-focus-ring)');
    expect(focused).toContain('outline-offset: -6px');
    expect(focused).toMatch(/box-shadow: 0 0 26px color-mix\(in srgb, var\(--color-accent\) 40%/);
  });

  it('presses a control to 0.92', () => {
    expect(block('.aura-window-control:active')).toContain('transform: scale(0.92)');
  });

  it('keeps close the only coloured control, and only under a pointer or a ring', () => {
    // One rule, two states: hover and the focus ring.
    expect(CSS).toMatch(
      /\.aura-window-control\[data-danger\]:hover,\s*\.aura-window-control\[data-danger\]\[data-focused\]/,
    );
    expect(block('.aura-window-control[data-danger]:hover')).toMatch(/var\(--color-danger\) 16%/);
  });

  it('draws chips at 9 by 18 with 12px corners', () => {
    const chip = block('.aura-window-chip');
    expect(chip).toContain('padding: 9px 18px');
    expect(chip).toContain('border-radius: 12px');
  });

  it('fills exactly one chip with the accent, in dark ink', () => {
    const active = block('.aura-window-chip[data-active]');
    expect(active).toContain('background: var(--color-accent)');
    expect(active).toContain('color: var(--color-accent-contrast)');

    // Accent discipline: the active chip is the only filled accent surface in the chrome. A
    // second one would make the fill decoration rather than a report of which view is showing.
    expect([...CSS.matchAll(/background: var\(--color-accent\)/g)]).toHaveLength(1);
  });

  it('never lets hover introduce colour', () => {
    // Hover raises alpha; the colour it raises is the theme's ink, not the accent.
    for (const hover of [
      block('.aura-window-control:hover'),
      block('.aura-window-chip:hover:not([data-active])'),
    ]) {
      expect(hover).not.toBe('');
      expect(hover).not.toContain('--color-accent');
      expect(hover).toMatch(/color-mix\(in srgb, var\(--color-text\)/);
    }
  });

  it('keeps a section header off the artwork it labels', () => {
    // Padding above a grid, not absolute positioning over one.
    const section = block('.aura-window-section');
    expect(section).toMatch(/padding: 14px var\(--spacing-edge\) 0/);
    expect(section).not.toContain('position: absolute');
  });
});
