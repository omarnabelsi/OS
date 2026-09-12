/**
 * Retracing a move that crossed from one focus group into another.
 *
 * Spatial navigation is not symmetric across groups, and on the desktop that was a real defect:
 * folders cluster on the left, the taskbar's Home button sits in the middle of the screen, so
 * Down from the bottom folder lands on the taskbar - but Up from the taskbar picks whatever is
 * best aligned above *it*, which is the nav bar, and the D-pad skips every folder on the way. A
 * pad user who dropped onto the taskbar had no way back to what they were doing.
 *
 * The fix is the one television interfaces use: a move that changes group remembers where it came
 * from, and the opposite press goes straight back. Inside a group the geometry is already
 * consistent, so nothing is recorded there and nothing overrides it.
 *
 * Pure, like `geometry.ts`, so the rule is testable without a DOM.
 */

import type { Direction } from './geometry';

export const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export interface ReturnPath {
  /** Where focus was before it left its group. */
  from: string;
  /** Where it landed. The path only applies while focus is still exactly here. */
  to: string;
  direction: Direction;
}

/**
 * The id a move should retrace to instead of asking the geometry, or null.
 *
 * Only while focus is still on the element the crossing landed on: once the user has moved along
 * the taskbar, or clicked something, "back" no longer means anything and the geometry decides.
 */
export function returnTarget(
  path: ReturnPath | null,
  currentId: string | null,
  direction: Direction,
): string | null {
  if (!path || currentId !== path.to) return null;
  return OPPOSITE[path.direction] === direction ? path.from : null;
}

/** The path to remember after a move, or null when the move stayed inside one group. */
export function recordPath(
  fromId: string,
  fromGroup: string | undefined,
  toId: string,
  toGroup: string | undefined,
  direction: Direction,
): ReturnPath | null {
  return fromGroup === toGroup ? null : { from: fromId, to: toId, direction };
}
