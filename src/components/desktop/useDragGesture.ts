/**
 * The press-or-drag gesture every desktop item shares.
 *
 * Pointer-based rather than HTML5 drag, because the surface needs live feedback - the item under
 * the cursor, the target cell highlighted - and HTML5 drag images cannot be styled by a theme.
 * Pointer capture means a fast drag that leaves the element still tracks.
 *
 * The whole subtlety is that a drag must not also count as a click. The pointer has to travel
 * past a small threshold before the gesture becomes a move, and only then is the click that the
 * browser synthesises afterwards suppressed.
 */

import { useRef, useState } from 'react';

import type { DesktopItem } from '@/bridge';

/** How far the pointer must travel before a press becomes a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface DragGestureOptions {
  item: DesktopItem;
  onActivate(): void;
  onDragStart(item: DesktopItem, pointerId: number): void;
  onDragMove(dx: number, dy: number): void;
  onDragEnd(): void;
}

export interface DragGesture {
  /** True once the threshold is passed - the item is being moved. */
  dragging: boolean;
  /** True between press and release, and cleared the moment a drag begins. */
  pressed: boolean;
  handlers: {
    onPointerDown(event: React.PointerEvent<HTMLElement>): void;
    onPointerMove(event: React.PointerEvent<HTMLElement>): void;
    onPointerUp(event: React.PointerEvent<HTMLElement>): void;
    onPointerCancel(event: React.PointerEvent<HTMLElement>): void;
    onClick(): void;
  };
}

export function useDragGesture({
  item,
  onActivate,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DragGestureOptions): DragGesture {
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Set the moment a press turns into a drag, and read by the click handler that follows.
  const moved = useRef(false);

  return {
    dragging,
    pressed,
    handlers: {
      onPointerDown(event) {
        // Left button (or touch/pen) only; right-click belongs to the context menu.
        if (event.button !== 0) return;
        origin.current = { x: event.clientX, y: event.clientY };
        moved.current = false;
        setPressed(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      },

      onPointerMove(event) {
        const from = origin.current;
        if (!from) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;

        if (!moved.current) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          moved.current = true;
          // A drag is no longer a press: the two states look different and must not overlap.
          setPressed(false);
          setDragging(true);
          onDragStart(item, event.pointerId);
        }
        onDragMove(dx, dy);
      },

      onPointerUp(event) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        origin.current = null;
        setPressed(false);
        if (moved.current) {
          setDragging(false);
          onDragEnd();
        }
      },

      onPointerCancel(event) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        origin.current = null;
        setPressed(false);
        if (moved.current) {
          setDragging(false);
          onDragEnd();
        }
      },

      onClick() {
        // The click that follows a drag is the end of the gesture, not an activation.
        if (moved.current) {
          moved.current = false;
          return;
        }
        onActivate();
      },
    },
  };
}
