import { describe, expect, it } from 'vitest';

import {
  KEEP_VISIBLE_PX,
  MIN_HEIGHT,
  MIN_WIDTH,
  cascadeRect,
  clampSize,
  constrainToDesktop,
  rectForSnap,
  resizeRect,
  snapRegionFor,
  type Rect,
} from './geometry';

/** A desktop area that does not start at the origin, so origin bugs cannot hide. */
const bounds: Rect = { x: 0, y: 72, width: 1366, height: 696 };

describe('clampSize', () => {
  it('refuses a window too small to operate', () => {
    expect(clampSize({ x: 0, y: 0, width: 10, height: 10 })).toMatchObject({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
  });

  it('leaves a reasonable window alone', () => {
    const rect = { x: 5, y: 5, width: 800, height: 600 };
    expect(clampSize(rect)).toEqual(rect);
  });
});

describe('constrainToDesktop', () => {
  it('lets a window overhang the sides but never disappear', () => {
    const rect = { x: -5000, y: 300, width: 600, height: 400 };
    const kept = constrainToDesktop(rect, bounds);
    // A strip is still on screen, so there is something to grab.
    expect(kept.x + kept.width).toBeGreaterThanOrEqual(bounds.x + KEEP_VISIBLE_PX);

    const right = constrainToDesktop({ ...rect, x: 99999 }, bounds);
    expect(right.x).toBeLessThanOrEqual(bounds.x + bounds.width - KEEP_VISIBLE_PX);
  });

  it('never lets the title bar go above the desktop - it is the only drag handle', () => {
    const kept = constrainToDesktop({ x: 100, y: -400, width: 600, height: 400 }, bounds);
    expect(kept.y).toBe(bounds.y);
  });

  it('never lets a window fall past the bottom', () => {
    const kept = constrainToDesktop({ x: 100, y: 99999, width: 600, height: 400 }, bounds);
    expect(kept.y).toBeLessThanOrEqual(bounds.y + bounds.height - KEEP_VISIBLE_PX);
  });

  it('handles a window narrower than the visible strip without inverting its range', () => {
    // `keepVisible` larger than the window itself must not produce min > max.
    const kept = constrainToDesktop({ x: -900, y: 300, width: 40, height: 40 }, bounds, 200);
    expect(kept.x).toBeGreaterThanOrEqual(bounds.x - 40);
    expect(Number.isFinite(kept.x)).toBe(true);
  });

  it('leaves a window that is already comfortably inside untouched', () => {
    const rect = { x: 200, y: 200, width: 600, height: 400 };
    expect(constrainToDesktop(rect, bounds)).toEqual(rect);
  });
});

describe('snapRegionFor', () => {
  const mid = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  it('finds nothing in the middle', () => {
    expect(snapRegionFor(mid, bounds)).toBeNull();
  });

  it('maximises at the top edge', () => {
    expect(snapRegionFor({ x: mid.x, y: bounds.y + 2 }, bounds)).toBe('maximise');
  });

  it('halves at the left and right edges', () => {
    expect(snapRegionFor({ x: bounds.x + 1, y: mid.y }, bounds)).toBe('left');
    expect(snapRegionFor({ x: bounds.x + bounds.width - 1, y: mid.y }, bounds)).toBe('right');
  });

  it('prefers a corner over the edge it sits on', () => {
    expect(snapRegionFor({ x: bounds.x + 1, y: bounds.y + 4 }, bounds)).toBe('top-left');
    expect(snapRegionFor({ x: bounds.x + bounds.width - 1, y: bounds.y + 4 }, bounds)).toBe(
      'top-right',
    );
    expect(snapRegionFor({ x: bounds.x + 1, y: bounds.y + bounds.height - 4 }, bounds)).toBe(
      'bottom-left',
    );
    expect(snapRegionFor({ x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 4 }, bounds)).toBe(
      'bottom-right',
    );
  });

  it('does not arm when the pointer has left the desktop entirely', () => {
    expect(snapRegionFor({ x: -500, y: mid.y }, bounds)).toBeNull();
    expect(snapRegionFor({ x: mid.x, y: -500 }, bounds)).toBeNull();
  });

  it('respects the desktop offset rather than assuming the screen origin', () => {
    // y just above the desktop's top is outside it, not "at the top edge".
    expect(snapRegionFor({ x: mid.x, y: bounds.y - 40 }, bounds)).toBeNull();
  });
});

describe('rectForSnap', () => {
  it('tiles the desktop exactly, with no gap down the middle', () => {
    const left = rectForSnap('left', bounds);
    const right = rectForSnap('right', bounds);
    expect(left.x).toBe(bounds.x);
    expect(left.x + left.width).toBe(right.x);
    expect(right.x + right.width).toBe(bounds.x + bounds.width);
    expect(left.height).toBe(bounds.height);
  });

  it('covers the desktop with the four quarters and nothing over the edge', () => {
    const quarters = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((r) =>
      rectForSnap(r, bounds),
    );
    const area = quarters.reduce((sum, q) => sum + q.width * q.height, 0);
    expect(area).toBe(bounds.width * bounds.height);
    for (const q of quarters) {
      expect(q.x).toBeGreaterThanOrEqual(bounds.x);
      expect(q.y).toBeGreaterThanOrEqual(bounds.y);
      expect(q.x + q.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(q.y + q.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('maximises to exactly the desktop area, not the screen', () => {
    expect(rectForSnap('maximise', bounds)).toEqual(bounds);
  });

  it('tiles an odd width without losing or gaining a pixel', () => {
    const odd: Rect = { x: 0, y: 0, width: 1367, height: 769 };
    const left = rectForSnap('left', odd);
    const right = rectForSnap('right', odd);
    expect(left.width + right.width).toBe(odd.width);
  });
});

describe('resizeRect', () => {
  const start: Rect = { x: 200, y: 200, width: 600, height: 400 };

  it('grows from the south-east without moving the origin', () => {
    expect(resizeRect(start, 'se', 100, 50)).toMatchObject({
      x: 200,
      y: 200,
      width: 700,
      height: 450,
    });
  });

  it('moves the origin when dragging the north-west corner', () => {
    expect(resizeRect(start, 'nw', 50, 40)).toMatchObject({
      x: 250,
      y: 240,
      width: 550,
      height: 360,
    });
  });

  it('stops at the minimum instead of walking the window across the screen', () => {
    // Dragging the west edge far past the minimum must pin the left edge, not keep moving it.
    const squashed = resizeRect(start, 'w', 5000, 0);
    expect(squashed.width).toBe(MIN_WIDTH);
    expect(squashed.x + squashed.width).toBe(start.x + start.width);

    const flattened = resizeRect(start, 'n', 5000, 5000);
    expect(flattened.height).toBe(MIN_HEIGHT);
    expect(flattened.y + flattened.height).toBe(start.y + start.height);
  });

  it('touches only the axis the edge belongs to', () => {
    expect(resizeRect(start, 'e', 100, 999)).toMatchObject({ height: 400, y: 200 });
    expect(resizeRect(start, 's', 999, 100)).toMatchObject({ width: 600, x: 200 });
  });
});

describe('cascadeRect', () => {
  it('offsets each new window so it does not hide the last', () => {
    const first = cascadeRect(bounds, 0);
    const second = cascadeRect(bounds, 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('wraps rather than marching off the desktop', () => {
    for (const index of [0, 3, 7, 25, 100]) {
      const rect = cascadeRect(bounds, index);
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x - rect.width + KEEP_VISIBLE_PX);
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('still produces a usable window on a tiny desktop', () => {
    const tiny: Rect = { x: 0, y: 0, width: 400, height: 260 };
    const rect = cascadeRect(tiny, 3);
    expect(rect.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(rect.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
  });
});
