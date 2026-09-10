/**
 * Window geometry: constraining, snapping, cascading. Pure functions over rectangles, so the
 * rules that decide "where does this window end up" are testable without a DOM.
 *
 * Unlike the desktop surface, windows genuinely are pixel-space - a window is sized to its
 * content and to what the user dragged, not to a grid.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How much of a window must stay on screen. Below this it becomes unreachable. */
export const KEEP_VISIBLE_PX = 96;
/** Smallest a window may be dragged down to; below this the chrome stops working. */
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 200;
/** How close to an edge the pointer must be for a snap to arm. */
export const SNAP_EDGE_PX = 12;
/** How far along an edge still counts as its corner, for quarter snapping. */
export const SNAP_CORNER_PX = 140;

export type SnapRegion =
  | 'left'
  | 'right'
  | 'maximise'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** Never smaller than the chrome needs to stay usable. */
export function clampSize(rect: Rect, minWidth = MIN_WIDTH, minHeight = MIN_HEIGHT): Rect {
  return {
    ...rect,
    width: Math.max(minWidth, rect.width),
    height: Math.max(minHeight, rect.height),
  };
}

/**
 * Keep a window reachable.
 *
 * A window dragged fully off the desktop can never be grabbed again - there is no OS taskbar
 * behind ours to rescue it from. So the horizontal edges may overhang, but a strip of the window
 * always stays on screen, and the title bar may never go above the top: that is the only part
 * you can drag it back by.
 */
export function constrainToDesktop(rect: Rect, bounds: Rect, keepVisible = KEEP_VISIBLE_PX): Rect {
  const visible = Math.min(keepVisible, rect.width);
  const minX = bounds.x - (rect.width - visible);
  const maxX = bounds.x + bounds.width - visible;
  const minY = bounds.y;
  const maxY = bounds.y + bounds.height - Math.min(keepVisible, rect.height);

  return {
    ...rect,
    x: Math.min(Math.max(rect.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rect.y, minY), Math.max(minY, maxY)),
  };
}

/**
 * Which snap the pointer is currently over, or null.
 *
 * Corners win over edges, and the top edge means maximise - the arrangement Windows users
 * already have in their fingers.
 */
export function snapRegionFor(
  pointer: { x: number; y: number },
  bounds: Rect,
  edge = SNAP_EDGE_PX,
  corner = SNAP_CORNER_PX,
): SnapRegion | null {
  const left = pointer.x <= bounds.x + edge;
  const right = pointer.x >= bounds.x + bounds.width - edge;
  const top = pointer.y <= bounds.y + edge;
  // There is deliberately no bottom edge region. It resolves to nothing in Windows either, and
  // phase 5 puts the taskbar there - a snap that fires while reaching for the taskbar would be a
  // gesture the user cannot avoid. The bottom *corners* still snap, being further from it.

  // Outside the desktop entirely: no snap, or dragging past a monitor edge would trigger one.
  if (
    pointer.x < bounds.x - edge ||
    pointer.x > bounds.x + bounds.width + edge ||
    pointer.y < bounds.y - edge ||
    pointer.y > bounds.y + bounds.height + edge
  ) {
    return null;
  }

  const nearTop = pointer.y <= bounds.y + corner;
  const nearBottom = pointer.y >= bounds.y + bounds.height - corner;

  if (left && nearTop) return 'top-left';
  if (left && nearBottom) return 'bottom-left';
  if (right && nearTop) return 'top-right';
  if (right && nearBottom) return 'bottom-right';
  if (left) return 'left';
  if (right) return 'right';
  if (top) return 'maximise';
  return null;
}

/** The rectangle a snap region resolves to inside the desktop area. */
export function rectForSnap(region: SnapRegion, bounds: Rect): Rect {
  // The far half takes the remainder rather than the same rounded figure: on an odd width the
  // two would otherwise sum to one pixel more than the desktop and overlap down the middle.
  const leftWidth = Math.round(bounds.width / 2);
  const rightWidth = bounds.width - leftWidth;
  const topHeight = Math.round(bounds.height / 2);
  const bottomHeight = bounds.height - topHeight;

  const rightX = bounds.x + leftWidth;
  const bottomY = bounds.y + topHeight;

  switch (region) {
    case 'maximise':
      return { ...bounds };
    case 'left':
      return { x: bounds.x, y: bounds.y, width: leftWidth, height: bounds.height };
    case 'right':
      return { x: rightX, y: bounds.y, width: rightWidth, height: bounds.height };
    case 'top-left':
      return { x: bounds.x, y: bounds.y, width: leftWidth, height: topHeight };
    case 'top-right':
      return { x: rightX, y: bounds.y, width: rightWidth, height: topHeight };
    case 'bottom-left':
      return { x: bounds.x, y: bottomY, width: leftWidth, height: bottomHeight };
    case 'bottom-right':
      return { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight };
  }
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Apply a resize drag.
 *
 * Dragging a north or west edge moves the origin as well as the size, and the minimum size has
 * to be enforced against *that* edge - otherwise shrinking past the minimum walks the window
 * across the screen instead of stopping.
 */
export function resizeRect(
  start: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  minWidth = MIN_WIDTH,
  minHeight = MIN_HEIGHT,
): Rect {
  let { x, y, width, height } = start;

  if (edge.includes('e')) width = start.width + dx;
  if (edge.includes('s')) height = start.height + dy;

  if (edge.includes('w')) {
    // Clamp the delta rather than the result, so the right edge stays put.
    const delta = Math.min(dx, start.width - minWidth);
    x = start.x + delta;
    width = start.width - delta;
  }
  if (edge.includes('n')) {
    const delta = Math.min(dy, start.height - minHeight);
    y = start.y + delta;
    height = start.height - delta;
  }

  return clampSize({ x, y, width, height }, minWidth, minHeight);
}

/**
 * Where a newly opened window goes.
 *
 * Cascaded from the top-left so a second window does not land exactly on the first and look
 * like nothing happened, wrapping back once the cascade would push it off the bottom.
 */
export function cascadeRect(bounds: Rect, index: number, step = 32): Rect {
  // A share of the desktop, but never below the minimum: on a small surface the proportional
  // figure comes out under it, and a window too small to operate is worse than one that
  // overhangs slightly.
  const width = Math.max(MIN_WIDTH, Math.min(Math.round(bounds.width * 0.62), bounds.width - 80));
  const height = Math.max(MIN_HEIGHT, Math.min(Math.round(bounds.height * 0.7), bounds.height - 80));

  // How many steps fit before the window would hang off the bottom-right.
  const maxSteps = Math.max(
    1,
    Math.floor(Math.min(bounds.width - width, bounds.height - height) / step) || 1,
  );
  const offset = (index % maxSteps) * step;

  return constrainToDesktop(
    {
      x: bounds.x + 48 + offset,
      y: bounds.y + 40 + offset,
      width,
      height,
    },
    bounds,
  );
}
