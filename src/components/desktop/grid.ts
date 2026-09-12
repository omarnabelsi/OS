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

/**
 * The desktop's grid is deliberately **not** square.
 *
 * A folder is 216 wide and up to 168 tall with its label under it, so a square cell would either
 * waste a band of space beside every folder or crop the tall shapes. The design's cell is
 * 259 x 240 including its gaps - seven of them span 1920 with a 64px margin either side, which is
 * where the 259 comes from.
 */
export const DESKTOP_COLUMNS = 7;

/**
 * Pixel geometry of the desktop grid.
 *
 * `strideX`/`strideY` are the *effective* cell - content plus the gap after it - because that is
 * the number a cell index multiplies by. The content box is the stride less the gap.
 */
export interface DesktopMetrics {
  strideX: number;
  strideY: number;
  gapX: number;
  gapY: number;
  columns: number;
  rows: number;
  snap: boolean;
}

/** Pixel offset of a cell along one axis. */
export function cellToPx(stride: number, index: number): number {
  return index * stride;
}

/** The cell a pixel offset falls in. Rounds, so a drag lands where it was aimed. */
export function pxToCell(stride: number, px: number): number {
  if (stride <= 0) return 0;
  return Math.round(px / stride);
}

/** The content box of one cell, which is the stride less the gap that follows it. */
export function cellSize(metrics: DesktopMetrics): { width: number; height: number } {
  return {
    width: Math.max(0, metrics.strideX - metrics.gapX),
    height: Math.max(0, metrics.strideY - metrics.gapY),
  };
}

/**
 * How many cells fit, given the strides.
 *
 * Columns are capped at `DESKTOP_COLUMNS`: the design is a seven-column composition, and letting
 * a wide monitor add an eighth would spread the same items thinner rather than better. Rows are
 * whatever fits, because vertical space is what actually varies.
 *
 * The final gap does not need to fit - an item in the last column has nothing after it - so the
 * gap is added back before dividing.
 */
export function desktopBounds(
  metrics: Pick<DesktopMetrics, 'strideX' | 'strideY' | 'gapX' | 'gapY'>,
  width: number,
  height: number,
): Bounds {
  const fitsX = metrics.strideX > 0 ? Math.floor((width + metrics.gapX) / metrics.strideX) : 1;
  const fitsY = metrics.strideY > 0 ? Math.floor((height + metrics.gapY) / metrics.strideY) : 1;
  return {
    columns: Math.max(1, Math.min(DESKTOP_COLUMNS, fitsX)),
    rows: Math.max(1, fitsY),
  };
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
 * Where each item should be *drawn*, which is not always where it is stored.
 *
 * The grid's cells are a fixed size, so a smaller display simply fits fewer of them: the design
 * is a seven-column composition at 1920, and at 1366 only four columns and two rows are on
 * screen. An item stored outside that - the seeded clock at column five, say - would not be
 * visible at all, and nothing would tell anyone it was there.
 *
 * So an out-of-bounds item is pulled to the nearest free cell **for display only**. The stored
 * cell is never touched, which is the entire reason positions are cells rather than pixels:
 * plug the larger monitor back in and the intended composition returns exactly as it was.
 * Rewriting the stored position to "fix" a small screen would destroy that, and the user would
 * never get their arrangement back.
 *
 * Items that already fit claim their cells first, so a displaced one fills a real gap rather
 * than landing on a neighbour that was where it belonged all along.
 */
export function placeForDisplay(
  items: DesktopItem[],
  bounds: Bounds,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const taken: DesktopItem[] = [];

  const fits = (i: DesktopItem) =>
    i.x >= 0 && i.y >= 0 && i.x + i.width <= bounds.columns && i.y + i.height <= bounds.rows;

  for (const item of items) {
    if (!fits(item)) continue;
    out.set(item.id, { x: item.x, y: item.y });
    taken.push(item);
  }

  for (const item of items) {
    if (fits(item)) continue;
    const span = { width: item.width, height: item.height };
    let pos = resolveDrop(item, clampToBounds(item.x, item.y, span, bounds), taken, bounds);

    /*
     * `resolveDrop` gives up by leaving the item where it was, which is right for a drag - a drop
     * with nowhere to go should not teleport the thing you were holding. Here it is wrong: where
     * it was is off the screen, which is the problem being solved. Its spiral can also miss a
     * free cell that exists, because the rings are clamped and a tight grid packs awkwardly. So
     * fall back to a plain scan, which finds a space if there is one at all.
     */
    if (!fits({ ...item, ...pos })) {
      const free = firstFreeCell(span, taken, bounds);
      // Still nothing: the display genuinely has no room, and the stored cell is the honest
      // answer. The item is off-screen, but its position is still what the user arranged.
      pos = free ?? pos;
    }

    out.set(item.id, pos);
    taken.push({ ...item, ...pos });
  }

  return out;
}

/** The first cell, in reading order, where `span` fits without touching anything in `taken`. */
function firstFreeCell(
  span: { width: number; height: number },
  taken: Array<{ x: number; y: number; width: number; height: number }>,
  bounds: Bounds,
): { x: number; y: number } | null {
  for (let y = 0; y + span.height <= bounds.rows; y++) {
    for (let x = 0; x + span.width <= bounds.columns; x++) {
      if (!taken.some((t) => overlaps({ ...span, x, y }, t))) return { x, y };
    }
  }
  return null;
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
