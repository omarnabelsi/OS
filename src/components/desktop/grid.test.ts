import { describe, expect, it } from 'vitest';

import type { DesktopItem, GridSettings } from '@/bridge';

import { cellToPixels, clampToBounds, gridBounds, overlaps, pixelsToCell, resolveDrop } from './grid';

const grid: GridSettings = { cell: 96, gap: 16, snap: true, autoArrange: false };

function item(id: string, x: number, y: number, width = 1, height = 1): DesktopItem {
  return {
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
  };
}

describe('cell <-> pixel conversion', () => {
  it('round-trips a cell through pixels', () => {
    for (const index of [0, 1, 5, 12]) {
      const px = cellToPixels(grid.cell, grid.gap, index);
      expect(pixelsToCell(grid.cell, grid.gap, px)).toBe(index);
    }
  });

  it('rounds to the nearest cell so a drag lands where it was aimed', () => {
    const stride = grid.cell + grid.gap; // 112
    expect(pixelsToCell(grid.cell, grid.gap, stride * 2 + 10)).toBe(2);
    expect(pixelsToCell(grid.cell, grid.gap, stride * 2 - 10)).toBe(2);
    // Past the halfway point it belongs to the next cell.
    expect(pixelsToCell(grid.cell, grid.gap, stride * 2 + stride * 0.6)).toBe(3);
  });

  it('survives a degenerate grid rather than dividing by zero', () => {
    expect(pixelsToCell(0, 0, 500)).toBe(0);
    expect(gridBounds({ ...grid, cell: 0, gap: 0 }, 800, 600)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('gridBounds', () => {
  it('counts whole cells, allowing for the gaps between them', () => {
    // 5 columns needs 5*96 + 4*16 = 544px.
    expect(gridBounds(grid, 544, 544).columns).toBe(5);
    expect(gridBounds(grid, 543, 543).columns).toBe(4);
  });

  it('never reports zero, so a tiny surface still places one item', () => {
    expect(gridBounds(grid, 10, 10)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('clampToBounds', () => {
  const bounds = { columns: 5, rows: 4 };

  it('keeps an item on the surface', () => {
    expect(clampToBounds(-3, -2, { width: 1, height: 1 }, bounds)).toEqual({ x: 0, y: 0 });
    expect(clampToBounds(99, 99, { width: 1, height: 1 }, bounds)).toEqual({ x: 4, y: 3 });
  });

  it('allows for an item that spans several cells', () => {
    expect(clampToBounds(99, 99, { width: 2, height: 2 }, bounds)).toEqual({ x: 3, y: 2 });
  });
});

describe('overlaps', () => {
  it('detects a shared cell and ignores adjacency', () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    expect(overlaps(a, { x: 1, y: 1, width: 1, height: 1 })).toBe(true);
    expect(overlaps(a, { x: 2, y: 0, width: 1, height: 1 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 2, width: 1, height: 1 })).toBe(false);
  });
});

describe('resolveDrop', () => {
  const bounds = { columns: 6, rows: 5 };

  it('takes the target cell when it is free', () => {
    const moving = item('a', 0, 0);
    expect(resolveDrop(moving, { x: 3, y: 2 }, [moving, item('b', 5, 4)], bounds)).toEqual({
      x: 3,
      y: 2,
    });
  });

  it('never stacks two icons in one cell - the lower one would be unreachable', () => {
    const moving = item('a', 0, 0);
    const occupied = item('b', 3, 2);
    const landed = resolveDrop(moving, { x: 3, y: 2 }, [moving, occupied], bounds);

    expect(landed).not.toEqual({ x: 3, y: 2 });
    // ...and it lands adjacent, not somewhere across the screen.
    expect(Math.abs(landed.x - 3) + Math.abs(landed.y - 2)).toBe(1);
  });

  it('spirals past a whole occupied neighbourhood', () => {
    const moving = item('a', 0, 4);
    const blocked = [
      item('b', 2, 1),
      item('c', 3, 1),
      item('d', 4, 1),
      item('e', 2, 2),
      item('f', 3, 2),
      item('g', 4, 2),
      item('h', 2, 3),
      item('i', 3, 3),
      item('j', 4, 3),
    ];
    const landed = resolveDrop(moving, { x: 3, y: 2 }, [moving, ...blocked], bounds);
    expect(blocked.some((b) => b.x === landed.x && b.y === landed.y)).toBe(false);
  });

  it('clamps a drop aimed off the surface back on to it', () => {
    const moving = item('a', 0, 0);
    expect(resolveDrop(moving, { x: -5, y: -5 }, [moving], bounds)).toEqual({ x: 0, y: 0 });
    expect(resolveDrop(moving, { x: 99, y: 99 }, [moving], bounds)).toEqual({ x: 5, y: 4 });
  });

  it('leaves the item where it was when the surface is completely full', () => {
    const moving = item('a', 0, 0);
    const everywhere: DesktopItem[] = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) everywhere.push(item(`x${x}${y}`, x, y));
    }
    const tiny = { columns: 2, rows: 2 };
    expect(resolveDrop(moving, { x: 1, y: 1 }, everywhere, tiny)).toEqual({ x: 0, y: 0 });
  });

  it('ignores the item being moved when testing for collisions', () => {
    // Dropping an item back where it already is must not count as a clash with itself.
    const moving = item('a', 2, 2);
    expect(resolveDrop(moving, { x: 2, y: 2 }, [moving], bounds)).toEqual({ x: 2, y: 2 });
  });
});
