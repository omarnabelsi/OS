import { describe, expect, it } from 'vitest';

import {
  centerOf,
  firstInReadingOrder,
  nearestTo,
  pickInDirection,
  type Candidate,
  type Rect,
} from './geometry';

const rect = (x: number, y: number, width = 100, height = 100): Rect => ({ x, y, width, height });
const at = (id: string, x: number, y: number, w = 100, h = 100): Candidate => ({
  id,
  rect: rect(x, y, w, h),
});

/**
 * A 3x3 grid of 100px tiles with 20px gutters, which is the shape the tile rows actually take.
 *
 *   a b c
 *   d e f
 *   g h i
 */
const GRID: Candidate[] = [
  at('a', 0, 0),
  at('b', 120, 0),
  at('c', 240, 0),
  at('d', 0, 120),
  at('e', 120, 120),
  at('f', 240, 120),
  at('g', 0, 240),
  at('h', 120, 240),
  at('i', 240, 240),
];

const from = (id: string): Rect => GRID.find((c) => c.id === id)!.rect;
const others = (id: string): Candidate[] => GRID.filter((c) => c.id !== id);
const pick = (id: string, direction: Parameters<typeof pickInDirection>[2]): string | null =>
  pickInDirection(from(id), others(id), direction)?.id ?? null;

describe('centerOf', () => {
  it('is the middle of the rectangle', () => {
    expect(centerOf(rect(0, 0, 100, 50))).toEqual({ x: 50, y: 25 });
    expect(centerOf(rect(10, 20, 100, 100))).toEqual({ x: 60, y: 70 });
  });
});

describe('pickInDirection', () => {
  it('walks along a row and a column from the centre', () => {
    expect(pick('e', 'left')).toBe('d');
    expect(pick('e', 'right')).toBe('f');
    expect(pick('e', 'up')).toBe('b');
    expect(pick('e', 'down')).toBe('h');
  });

  it('stops at the edges instead of wrapping', () => {
    expect(pick('a', 'left')).toBeNull();
    expect(pick('a', 'up')).toBeNull();
    expect(pick('i', 'right')).toBeNull();
    expect(pick('i', 'down')).toBeNull();
  });

  it('prefers the aligned neighbour over a nearer diagonal one', () => {
    // `far` sits in the same row but further away; `near` is closer in raw distance but on a
    // genuinely different row (no vertical overlap). A grid must still walk the row.
    const near = at('near', 130, 150);
    const far = at('far', 300, 0);
    const picked = pickInDirection(rect(0, 0), [near, far], 'right');
    expect(picked?.id).toBe('far');
  });

  it('falls back to an off-row candidate when the row is empty', () => {
    const below = at('below', 300, 400);
    expect(pickInDirection(rect(0, 0), [below], 'right')?.id).toBe('below');
  });

  it('never picks something behind or beside the origin', () => {
    const behind = at('behind', -200, 0);
    const beside = at('beside', 0, 0);
    expect(pickInDirection(rect(0, 0), [behind, beside], 'right')).toBeNull();
  });

  it('ignores zero-sized candidates', () => {
    const hidden: Candidate = { id: 'hidden', rect: rect(200, 0, 0, 0) };
    const visible = at('visible', 400, 0);
    expect(pickInDirection(rect(0, 0), [hidden, visible], 'right')?.id).toBe('visible');
    expect(pickInDirection(rect(0, 0), [hidden], 'right')).toBeNull();
  });

  it('handles an empty candidate list', () => {
    expect(pickInDirection(rect(0, 0), [], 'up')).toBeNull();
  });

  it('moves from a wide nav bar down into the nearest column', () => {
    // The nav bar is a wide, short strip above a row of tiles - the real layout.
    const navItem = rect(300, 0, 90, 40);
    const tiles = [at('t1', 0, 200, 200, 300), at('t2', 240, 200, 200, 300), at('t3', 480, 200, 200, 300)];
    expect(pickInDirection(navItem, tiles, 'down')?.id).toBe('t2');
  });

  it('moves from a tile up into the nav bar', () => {
    const nav = [at('home', 0, 0, 90, 40), at('games', 110, 0, 90, 40), at('apps', 220, 0, 90, 40)];
    const tile = rect(230, 200, 200, 300);
    expect(pickInDirection(tile, nav, 'up')?.id).toBe('apps');
  });

  it('is symmetric: moving right then left returns to the start', () => {
    for (const id of ['a', 'b', 'd', 'e', 'h']) {
      const right = pickInDirection(from(id), others(id), 'right');
      if (!right) continue;
      const back = pickInDirection(right.rect, GRID.filter((c) => c.id !== right.id), 'left');
      expect(back?.id).toBe(id);
    }
  });
});

describe('firstInReadingOrder', () => {
  it('picks the top-left item', () => {
    expect(firstInReadingOrder(GRID)?.id).toBe('a');
    expect(firstInReadingOrder([...GRID].reverse())?.id).toBe('a');
  });

  it('treats slightly misaligned items as the same row', () => {
    // 8px of drift is well within half a tile height, so x decides.
    const items = [at('right', 200, 0), at('left', 0, 8)];
    expect(firstInReadingOrder(items)?.id).toBe('left');
  });

  it('returns null for nothing visible', () => {
    expect(firstInReadingOrder([])).toBeNull();
    expect(firstInReadingOrder([{ id: 'x', rect: rect(0, 0, 0, 0) }])).toBeNull();
  });
});

describe('nearestTo', () => {
  it('finds the closest item by centre distance', () => {
    expect(nearestTo(from('e'), others('e'))?.id).toBe('b');
    expect(nearestTo(rect(1000, 1000), GRID)?.id).toBe('i');
  });

  it('returns null when there is nothing to pick', () => {
    expect(nearestTo(rect(0, 0), [])).toBeNull();
  });
});
