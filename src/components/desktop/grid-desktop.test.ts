/**
 * The desktop's rectangular grid.
 *
 * `grid.test.ts` covers the cell-space maths (drop resolution, overlap, clamping), which is
 * axis-agnostic. What is only true of the desktop is that its two axes have different strides -
 * a folder is 216 wide and up to 168 tall - and that the composition is seven columns wide
 * whatever the monitor.
 */

import { describe, expect, it } from 'vitest';

import type { DesktopItem } from '@/bridge';

import {
  DESKTOP_COLUMNS,
  cellSize,
  cellToPx,
  desktopBounds,
  placeForDisplay,
  pxToCell,
} from './grid';

/** The design's grid: 259 x 240 effective, from 24/40 gaps. */
const METRICS = { strideX: 259, strideY: 240, gapX: 24, gapY: 40 };

describe('cell <-> pixel, per axis', () => {
  it('round-trips a cell on each axis independently', () => {
    for (const index of [0, 1, 4, 6]) {
      expect(pxToCell(METRICS.strideX, cellToPx(METRICS.strideX, index))).toBe(index);
      expect(pxToCell(METRICS.strideY, cellToPx(METRICS.strideY, index))).toBe(index);
    }
  });

  it('does not confuse the two axes', () => {
    // The bug this guards: using one stride for both puts a drop in the wrong row on any grid
    // whose cell is not square, which is every desktop.
    expect(cellToPx(METRICS.strideX, 2)).toBe(518);
    expect(cellToPx(METRICS.strideY, 2)).toBe(480);
  });

  it('rounds to the nearest cell so a drag lands where it was aimed', () => {
    expect(pxToCell(METRICS.strideX, 259 * 2 + 20)).toBe(2);
    expect(pxToCell(METRICS.strideX, 259 * 2 - 20)).toBe(2);
    expect(pxToCell(METRICS.strideX, 259 * 2 + 259 * 0.6)).toBe(3);
  });

  it('survives a degenerate stride rather than dividing by zero', () => {
    expect(pxToCell(0, 500)).toBe(0);
  });
});

describe('cellSize', () => {
  it('is the stride less the gap that follows it', () => {
    const size = cellSize({ ...METRICS, columns: 7, rows: 3, snap: true });
    expect(size).toEqual({ width: 235, height: 200 });
  });
});

describe('placeForDisplay', () => {
  const item = (id: string, x: number, y: number, width = 1, height = 1): DesktopItem => ({
    id,
    desktopId: 'd1',
    kind: 'folder',
    targetId: `f-${id}`,
    x,
    y,
    width,
    height,
    labelOverride: null,
    iconOverride: null,
    sortOrder: 0,
  });

  const big = { columns: 7, rows: 4 };
  const small = { columns: 4, rows: 2 };

  it('leaves everything where it is when it all fits', () => {
    const items = [item('a', 0, 0), item('b', 0, 3), item('c', 5, 1, 2)];
    const placed = placeForDisplay(items, big);
    for (const i of items) {
      expect(placed.get(i.id)).toEqual({ x: i.x, y: i.y });
    }
  });

  it('pulls an item stored off the edge into view', () => {
    // The seeded clock lives at column five, which does not exist on a 1366-wide display.
    const clock = item('clock', 5, 0, 2);
    const placed = placeForDisplay([item('a', 0, 0), clock], small);
    const at = placed.get('clock')!;
    expect(at.x + clock.width).toBeLessThanOrEqual(small.columns);
    expect(at.y + clock.height).toBeLessThanOrEqual(small.rows);
  });

  it('never rewrites what is stored', () => {
    // The point of cells: plug the big monitor back in and the composition returns. If this
    // function mutated the items, that would be gone for good.
    const items = [item('a', 0, 0), item('clock', 5, 0, 2), item('b', 0, 3)];
    const before = JSON.stringify(items);
    placeForDisplay(items, small);
    expect(JSON.stringify(items)).toBe(before);
  });

  it('does not drop a displaced item on top of one that already fitted', () => {
    const staying = item('a', 0, 0);
    const displaced = item('b', 0, 9);
    const placed = placeForDisplay([staying, displaced], small);
    expect(placed.get('a')).toEqual({ x: 0, y: 0 });
    expect(placed.get('b')).not.toEqual({ x: 0, y: 0 });
  });

  it('finds the last free cell in a grid that is exactly full', () => {
    /*
     * The seeded desktop on a 1366-wide display: four folders and two double-width widgets in a
     * 4 x 2 grid - eight cells of demand in eight cells of space. The spiral search alone left
     * the last widget where it was, which is off the screen; the scan fallback finds the gap.
     */
    const items = [
      item('f1', 0, 0),
      item('f2', 0, 1),
      item('f3', 0, 2),
      item('f4', 0, 3),
      item('clock', 5, 0, 2),
      item('now', 5, 1, 2),
    ];
    const placed = placeForDisplay(items, small);

    for (const i of items) {
      const at = placed.get(i.id)!;
      expect(at.x + i.width, `${i.id} runs off the right`).toBeLessThanOrEqual(small.columns);
      expect(at.y + i.height, `${i.id} runs off the bottom`).toBeLessThanOrEqual(small.rows);
    }

    // And nothing landed on top of anything else.
    const cells = items.flatMap((i) => {
      const at = placed.get(i.id)!;
      return Array.from({ length: i.width * i.height }, (_, n) => {
        const dx = n % i.width;
        const dy = Math.floor(n / i.width);
        return `${at.x + dx},${at.y + dy}`;
      });
    });
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('places every item exactly once, whatever the bounds', () => {
    const items = [item('a', 0, 0), item('b', 0, 1), item('c', 0, 2), item('d', 0, 3), item('e', 5, 0, 2)];
    for (const bounds of [big, small, { columns: 1, rows: 1 }]) {
      const placed = placeForDisplay(items, bounds);
      expect(placed.size).toBe(items.length);
    }
  });
});

describe('desktopBounds', () => {
  it('fits seven columns in 1920 inside a 64px margin', () => {
    // Which is where 259 comes from: 7 x 259 - 24 = 1789, against 1920 - 128 = 1792 of usable
    // width. The design's composition is exact rather than approximate.
    const usable = 1920 - 64 * 2;
    expect(desktopBounds(METRICS, usable, 1080 - 64 * 2).columns).toBe(7);
  });

  it('never offers more than seven columns, however wide the monitor', () => {
    // A wider screen should not spread the same items thinner - the composition is seven wide.
    expect(desktopBounds(METRICS, 6000, 2000).columns).toBe(DESKTOP_COLUMNS);
  });

  it('gives up columns on a narrow window rather than overflowing', () => {
    expect(desktopBounds(METRICS, 600, 800).columns).toBe(2);
    expect(desktopBounds(METRICS, 100, 800).columns).toBe(1);
  });

  it('counts rows by the taller stride', () => {
    // 3 rows need 3 x 240 - 40 = 680.
    expect(desktopBounds(METRICS, 1792, 680).rows).toBe(3);
    expect(desktopBounds(METRICS, 1792, 679).rows).toBe(2);
  });

  it('always offers at least one cell', () => {
    expect(desktopBounds(METRICS, 0, 0)).toEqual({ columns: 1, rows: 1 });
    expect(desktopBounds({ strideX: 0, strideY: 0, gapX: 0, gapY: 0 }, 800, 600)).toEqual({
      columns: 1,
      rows: 1,
    });
  });
});
