/**
 * Spatial navigation maths. Pure functions over rectangles - no DOM, no React - so the rules
 * that decide "what is to the right of this tile" can be tested directly.
 *
 * The model: a move succeeds only if a candidate actually lies in the requested direction. Among
 * those, the winner is the one with the lowest cost, where cost is distance travelled along the
 * direction of travel plus a heavy penalty for drifting off the current row or column. That
 * penalty is what makes a grid feel like a grid: pressing right walks along a row rather than
 * diving diagonally at the nearest thing on screen.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Candidate {
  id: string;
  rect: Rect;
}

/** Drifting one pixel off-axis costs this many pixels of forward progress. */
const CROSS_AXIS_WEIGHT = 30;
/** Gentle tie-break between candidates that all overlap the current row/column. */
const ALIGNMENT_WEIGHT = 0.2;
/** A candidate must move at least this far in the direction of travel to count. */
const MIN_PROGRESS = 1;

export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

const isHorizontal = (d: Direction): boolean => d === 'left' || d === 'right';
/** +1 when the direction increases the coordinate (right / down). */
const signOf = (d: Direction): number => (d === 'right' || d === 'down' ? 1 : -1);

/** Overlap of two 1-D spans. Negative means a gap of that many pixels. */
function spanOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

/**
 * The best candidate in `direction`, or null when nothing lies that way.
 * `from` is excluded automatically: it makes no forward progress against itself.
 */
export function pickInDirection<T extends Candidate>(
  from: Rect,
  candidates: readonly T[],
  direction: Direction,
): T | null {
  const horizontal = isHorizontal(direction);
  const sign = signOf(direction);
  const fromCenter = centerOf(from);

  let best: T | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const rect = candidate.rect;
    if (rect.width <= 0 || rect.height <= 0) continue; // hidden or unlaid-out

    const center = centerOf(rect);

    // How far this candidate lies in the direction we are travelling.
    const progress = ((horizontal ? center.x : center.y) - (horizontal ? fromCenter.x : fromCenter.y)) * sign;
    if (progress < MIN_PROGRESS) continue;

    // How far it strays across that direction.
    const overlap = horizontal
      ? spanOverlap(from.y, from.y + from.height, rect.y, rect.y + rect.height)
      : spanOverlap(from.x, from.x + from.width, rect.x, rect.x + rect.width);
    const gap = overlap > 0 ? 0 : -overlap;

    const alignment = Math.abs(
      (horizontal ? center.y : center.x) - (horizontal ? fromCenter.y : fromCenter.x),
    );

    const cost = progress + gap * CROSS_AXIS_WEIGHT + alignment * ALIGNMENT_WEIGHT;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }

  return best;
}

/** Reading order: topmost first, then leftmost. Used to pick an initial focus. */
export function firstInReadingOrder<T extends Candidate>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate.rect.width <= 0 || candidate.rect.height <= 0) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    // Same row (within half a tile height) means compare by x instead of y.
    const sameRow = Math.abs(candidate.rect.y - best.rect.y) < best.rect.height / 2;
    if (sameRow ? candidate.rect.x < best.rect.x : candidate.rect.y < best.rect.y) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The candidate closest to `from` by centre distance. Used when focus is restored after the
 * focused element disappears (a scan removing an entry, a filter changing).
 */
export function nearestTo<T extends Candidate>(from: Rect, candidates: readonly T[]): T | null {
  const fromCenter = centerOf(from);
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.rect.width <= 0 || candidate.rect.height <= 0) continue;
    const center = centerOf(candidate.rect);
    const distance = Math.hypot(center.x - fromCenter.x, center.y - fromCenter.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
