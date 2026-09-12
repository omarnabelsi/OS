/**
 * Formatting the host's clock.
 *
 * The whole point of taking the time from the host is that the *host* decides what time it is,
 * including which zone it is in. These tests pin that: the same instant formats differently for
 * different host offsets, and never according to whatever zone the test runner happens to be in.
 */

import { describe, expect, it } from 'vitest';

import { formatClock, formatHostTime, formatLongDate, formatShortDate } from './shellStatus';

/** A fixed instant, built explicitly so the test does not depend on my arithmetic: 09:41 UTC. */
const EPOCH = Date.UTC(2026, 8, 12, 9, 41, 0);

const hhmm = (epochMs: number, offsetMinutes: number) =>
  formatHostTime(epochMs, offsetMinutes, { hour: '2-digit', minute: '2-digit', hour12: false });

describe('formatHostTime', () => {
  it('formats in the host timezone, not the webview one', () => {
    expect(hhmm(EPOCH, 0)).toBe('09:41');
    expect(hhmm(EPOCH, 60)).toBe('10:41');
    expect(hhmm(EPOCH, 330)).toBe('15:11');
    expect(hhmm(EPOCH, -300)).toBe('04:41');
  });

  it('carries the date across a day boundary', () => {
    // 23:41 local the previous day, from an instant at 09:41 UTC, is a -600 offset (UTC-10).
    expect(hhmm(EPOCH, -600)).toBe('23:41');
    expect(formatHostTime(EPOCH, -600, { day: 'numeric', timeZone: undefined })).toBe('11');
  });

  it('handles the extremes of real timezones', () => {
    expect(hhmm(EPOCH, 14 * 60)).toBe('23:41');
    expect(hhmm(EPOCH, -12 * 60)).toBe('21:41');
  });
});

describe('the formats the shell actually shows', () => {
  it('gives the taskbar a time and a short date', () => {
    // Locale decides the separator and the order, so assert on the parts rather than the string.
    expect(formatClock(EPOCH, 0)).toMatch(/\d/);
    expect(formatShortDate(EPOCH, 0)).toMatch(/12/);
  });

  it('gives the widget a long date', () => {
    const long = formatLongDate(EPOCH, 0);
    expect(long).toMatch(/12/);
    // A weekday is what makes it a caption rather than a repeat of the clock.
    expect(long.length).toBeGreaterThan(formatShortDate(EPOCH, 0).length);
  });

  it('does not shift the date when the offset does not cross a boundary', () => {
    expect(formatShortDate(EPOCH, 60)).toBe(formatShortDate(EPOCH, 0));
  });
});
