/**
 * The two decisions the blur engine makes before it has counted a single frame.
 *
 * The probe itself is exercised through `nextMode` in `fps.test.ts`; what matters here is that a
 * theme without blur, and a user who turned blur off, are both honoured immediately rather than
 * two seconds later.
 */

import { describe, expect, it } from 'vitest';

import { blurDisabledByTheme, initialMode } from './engine';

describe('blurDisabledByTheme', () => {
  it('reads every way a theme might write zero', () => {
    expect(blurDisabledByTheme(0)).toBe(true);
    expect(blurDisabledByTheme('0')).toBe(true);
    expect(blurDisabledByTheme('0px')).toBe(true);
    expect(blurDisabledByTheme('0rem')).toBe(true);
  });

  it('leaves a theme that does blur alone', () => {
    expect(blurDisabledByTheme('18px')).toBe(false);
    expect(blurDisabledByTheme(18)).toBe(false);
  });

  it('treats a missing or unreadable token as "no opinion"', () => {
    // The fallback in base.css supplies a real blur, so silence must not mean off.
    expect(blurDisabledByTheme(undefined)).toBe(false);
    expect(blurDisabledByTheme('inherit')).toBe(false);
  });
});

describe('initialMode', () => {
  it('lets the theme win over the user', () => {
    expect(initialMode('full', true)).toBe('off');
    expect(initialMode('auto', true)).toBe('off');
  });

  it('honours the user when the theme has no objection', () => {
    expect(initialMode('off', false)).toBe('off');
    expect(initialMode('full', false)).toBe('full');
    expect(initialMode('auto', false)).toBe('full');
  });
});
