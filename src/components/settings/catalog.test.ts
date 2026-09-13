/**
 * The settings catalog and its search.
 *
 * One definition feeds both the Settings screen and the Settings window, so these tests are
 * about the data: that every row is uniquely addressable, that search finds a setting by the
 * words a user would actually type, and that adjusting a stepped setting stops at the ends.
 */

import { describe, expect, it, vi } from 'vitest';

import { baseSettings } from '@/store/test-helpers';

import { buildCatalog, rowMatches, searchCatalog, step, type CatalogContext } from './catalog';

function context(overrides: Partial<CatalogContext> = {}): CatalogContext {
  return {
    settings: { ...baseSettings },
    set: vi.fn(),
    themeName: 'Aura',
    themes: [],
    pickTheme: vi.fn(),
    hotkey: null,
    cycleExitHotkey: vi.fn(),
    scanning: false,
    itemCount: 3,
    startScan: vi.fn(),
    addProgram: vi.fn(),
    exitShell: vi.fn(),
    ...overrides,
  };
}

const ids = (categories: ReturnType<typeof buildCatalog>) =>
  categories.flatMap((c) => c.rows.map((r) => r.id));

describe('settings catalog', () => {
  it('gives every row an id no other row has', () => {
    // Focus ids are derived from these; a duplicate would make two rows one focus target.
    const all = ids(buildCatalog(context()));
    expect(new Set(all).size).toBe(all.length);
  });

  it('has no empty category', () => {
    for (const category of buildCatalog(context())) expect(category.rows.length).toBeGreaterThan(0);
  });

  it('finds a setting by a word its label does not contain', () => {
    const found = ids(searchCatalog(buildCatalog(context()), 'controller'));
    expect(found).toEqual(['gamepadEnabled']);
  });

  it('searches across every category at once', () => {
    const results = searchCatalog(buildCatalog(context()), 'taskbar');
    // Genuinely spans two categories: the accent row's own hint names the taskbar indicators it
    // recolours, alongside the taskbar rows proper - which is what this test is actually about.
    expect(results.map((c) => c.id)).toEqual(['appearance', 'desktop']);
    expect(ids(results)).toEqual([
      'accentColor',
      'taskbarVisible',
      'taskbarPosition',
      'taskbarAlignment',
      'taskbarScale',
    ]);
  });

  it('requires every word of a multi-word query', () => {
    // "Exit to Windows" matches "exit" but not "hotkey"; only the hotkey row matches both.
    expect(ids(searchCatalog(buildCatalog(context()), 'exit hotkey'))).toEqual(['exitHotkey']);
  });

  it('returns the catalog untouched for an empty query', () => {
    const catalog = buildCatalog(context());
    expect(searchCatalog(catalog, '   ')).toBe(catalog);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(searchCatalog(buildCatalog(context()), 'zzzz-no-such-setting')).toEqual([]);
  });

  it('answers a search for music honestly: there is no such setting, and it says so', () => {
    // The app has no music playback. Searching for it should land on the one row that says so,
    // never on a control that would suggest otherwise.
    const rows = searchCatalog(buildCatalog(context()), 'music').flatMap((c) => c.rows);
    expect(rows.map((r) => r.id)).toEqual(['soundsEnabled']);
    expect(rows[0]!.hint).toMatch(/no music/i);
  });

  it('matches case-insensitively over label, hint and keywords', () => {
    const row = { id: 'x', label: 'Interface scale', hint: 'Left and right', keywords: 'zoom' };
    expect(rowMatches(row, 'SCALE')).toBe(true);
    expect(rowMatches(row, 'zoom')).toBe(true);
    expect(rowMatches(row, 'right')).toBe(true);
    expect(rowMatches(row, 'volume')).toBe(false);
  });
});

describe('stepped settings', () => {
  function row(id: string, ctx: CatalogContext) {
    return buildCatalog(ctx)
      .flatMap((c) => c.rows)
      .find((r) => r.id === id)!;
  }

  it('moves the taskbar to the next edge', () => {
    const ctx = context();
    row('taskbarPosition', ctx).onAdjust!(1);
    expect(ctx.set).toHaveBeenCalledWith({ taskbarPosition: 'top' });
  });

  it('stops at the last edge instead of wrapping', () => {
    const ctx = context({ settings: { ...baseSettings, taskbarPosition: 'right' } });
    row('taskbarPosition', ctx).onAdjust!(1);
    expect(ctx.set).toHaveBeenCalledWith({ taskbarPosition: 'right' });
  });

  it('switches theme through the picker, and does nothing with only one theme', () => {
    const lone = context({ themes: [] });
    row('theme', lone).onActivate!();
    expect(lone.pickTheme).not.toHaveBeenCalled();

    const two = context({
      themes: [
        { id: 'aura-default' } as CatalogContext['themes'][number],
        { id: 'aura-paper' } as CatalogContext['themes'][number],
      ],
    });
    row('theme', two).onActivate!();
    expect(two.pickTheme).toHaveBeenCalledWith('aura-paper');
  });

  it('clamps numeric steps to their range', () => {
    expect(step(1.98, 1, 0.5, 2, 0.05)).toBe(2);
    expect(step(0.52, -1, 0.5, 2, 0.05)).toBe(0.5);
    expect(step(1, 1, 0.5, 2, 0.05)).toBe(1.05);
  });

  it('cycles the accent preset, wrapping on activate but not on adjust', () => {
    const ctx = context();
    row('accentColor', ctx).onAdjust!(1);
    expect(ctx.set).toHaveBeenCalledWith({ accentColor: '#6ee7ff' });

    const atEnd = context({ settings: { ...baseSettings, accentColor: '#8fe38f' } });
    row('accentColor', atEnd).onAdjust!(1);
    expect(atEnd.set).toHaveBeenCalledWith({ accentColor: '#8fe38f' });

    const wraps = context({ settings: { ...baseSettings, accentColor: '#8fe38f' } });
    row('accentColor', wraps).onActivate!();
    expect(wraps.set).toHaveBeenCalledWith({ accentColor: null });
  });

  it('adjusts taskbar size and tile scale independently, each within its own range', () => {
    const ctx = context();
    row('taskbarScale', ctx).onAdjust!(1);
    expect(ctx.set).toHaveBeenCalledWith({ taskbarScale: 1.05 });
    row('tileScale', ctx).onAdjust!(1);
    expect(ctx.set).toHaveBeenCalledWith({ tileScale: 1.05 });

    const atFloor = context({ settings: { ...baseSettings, taskbarScale: 0.7 } });
    row('taskbarScale', atFloor).onAdjust!(-1);
    expect(atFloor.set).toHaveBeenCalledWith({ taskbarScale: 0.7 });
  });
});
