/**
 * Grid maths for the desktop surface. Pure, so the awkward part - where a dragged icon lands -
 * is testable without a DOM.
 *
 * Items are stored in **cells**; only this file and the surface convert to pixels. That is what
 * lets an arrangement made at 1080p survive a 4K monitor: the cell size changes, the stored
 * positions do not.
 */

import type { DesktopItem, GridSettings } from '@/bridge';

/** Pixel offset of a cell's top-left corner, including the gap before it. */
export function cellToPixels(cell: number, gap: number, index: number): number {
  return index * (cell + gap);
}

/** The cell a pixel offset falls in. Rounds to the nearest cell, so a drag lands where aimed. */
export function pixelsToCell(cell: number, gap: number, px: number): number {
  const stride = cell + gap;
  if (stride <= 0) return 0;
  return Math.round(px / stride);
}

export interface Bounds {
  /** Columns and rows that fit, at least 1 so a tiny window still places something. */
  columns: number;
  rows: number;
}

/** How many whole cells fit in a surface of this pixel size. */
export function gridBounds(grid: GridSettings, width: number, height: number): Bounds {
  const stride = grid.cell + grid.gap;
  if (stride <= 0) return { columns: 1, rows: 1 };
  return {
    columns: Math.max(1, Math.floor((width + grid.gap) / stride)),
    rows: Math.max(1, Math.floor((height + grid.gap) / stride)),
  };
}

/** Keep a cell inside the surface, allowing for an item that spans more than one. */
export function clampToBounds(
  x: number,
  y: number,
  span: { width: number; height: number },
  bounds: Bounds,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, bounds.columns - span.width)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.rows - span.height)),
  };
}

/** True when two items overlap on the grid. */
export function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

/**
 * Where a drop should actually land.
 *
 * Snapping to the nearest cell is only half the job: two icons in the same cell hide each other,
 * and the one underneath becomes unreachable. When the target is taken, spiral outwards to the
 * closest free cell instead of refusing the move, which is what Windows does and what people
 * expect.
 */
export function resolveDrop(
  moving: DesktopItem,
  desired: { x: number; y: number },
  others: DesktopItem[],
  bounds: Bounds,
): { x: number; y: number } {
  const span = { width: moving.width, height: moving.height };
  const start = clampToBounds(desired.x, desired.y, span, bounds);

  const taken = (x: number, y: number) =>
    others.some((o) => o.id !== moving.id && overlaps({ ...span, x, y }, o));

  if (!taken(start.x, start.y)) return start;

  // Rings of increasing radius around the target. Within a ring, the *closest* free cell wins
  // rather than the first one the scan happens to reach: a ring's corners are further away than
  // its edges, so taking scan order would push an icon diagonally when the cell directly beside
  // it was free.
  const maxRadius = Math.max(bounds.columns, bounds.rows);
  for (let radius = 1; radius <= maxRadius; radius++) {
    let best: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Only the ring's edge; the inside was covered by a smaller radius.
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const candidate = clampToBounds(start.x + dx, start.y + dy, span, bounds);
        if (taken(candidate.x, candidate.y)) continue;

        const ox = candidate.x - start.x;
        const oy = candidate.y - start.y;
        const distance = ox * ox + oy * oy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
    if (best) return best;
  }

  // Every cell is occupied. Leave the item where it was rather than stacking it invisibly.
  return { x: moving.x, y: moving.y };
}
