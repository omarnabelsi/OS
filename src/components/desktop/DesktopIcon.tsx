/**
 * One item on the desktop: a folder, or a shortcut to something in the library.
 *
 * Dragging is pointer-based rather than an HTML5 drag, because the surface needs live feedback
 * (the icon under the cursor, the target cell highlighted) and HTML5 drag images cannot be
 * styled by a theme. Pointer capture means a fast drag that leaves the element still tracks.
 *
 * A drag must not also count as a click: the pointer has to travel past a small threshold before
 * the gesture becomes a move, and only then is the following click suppressed.
 */

import { motion } from 'framer-motion';
import { useRef, useState } from 'react';

import type { DesktopItem, Folder, LibraryItem } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useSettingsStore } from '@/store';

import { Icon } from '../Icon';
import { FolderGlyph } from './FolderGlyph';

/** How far the pointer must travel before a press becomes a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface DesktopIconProps {
  item: DesktopItem;
  folder: Folder | undefined;
  entry: LibraryItem | undefined;
  /** Live pixel offset while dragging, or null. Owned by the surface. */
  dragOffset: { dx: number; dy: number } | null;
  onActivate(): void;
  onDragStart(item: DesktopItem, pointerId: number): void;
  onDragMove(dx: number, dy: number): void;
  onDragEnd(): void;
}

export function DesktopIcon({
  item,
  folder,
  entry,
  dragOffset,
  onActivate,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DesktopIconProps): React.JSX.Element {
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Set the moment a press turns into a drag, and read by the click handler that follows.
  const movedRef = useRef(false);

  const label = item.labelOverride ?? folder?.label ?? entry?.name ?? 'Untitled';

  const { ref, focused, props } = useFocusable({
    id: `desktop:${item.id}`,
    group: 'desktop',
    onActivate,
  });

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    // Left button (or touch/pen) only; right-click belongs to the context menu.
    if (event.button !== 0) return;
    origin.current = { x: event.clientX, y: event.clientY };
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const from = origin.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;

    if (!movedRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      movedRef.current = true;
      setDragging(true);
      onDragStart(item, event.pointerId);
    }
    onDragMove(dx, dy);
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    origin.current = null;
    if (movedRef.current) {
      setDragging(false);
      onDragEnd();
    }
  };

  const art = entry ? assetUrl(entry.artwork.icon ?? entry.artwork.grid ?? undefined) : undefined;

  return (
    <motion.button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-desktop-icon"
      data-dragging={dragging || undefined}
      title={label}
      animate={{ scale: focused && !reduceMotion && !dragging ? 1.06 : 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
      style={
        dragOffset
          ? { transform: `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)` }
          : undefined
      }
      onPointerDown={beginDrag}
      onPointerMove={continueDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      {...props}
      onClick={() => {
        // The click that follows a drag is the end of the gesture, not an open.
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        props.onClick();
      }}
    >
      <span className="aura-desktop-icon-art">
        {item.kind === 'folder' ? (
          <FolderGlyph folder={folder} />
        ) : art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <Icon name="apps" size="1em" />
        )}
      </span>
      <span className="aura-desktop-icon-label">{label}</span>
    </motion.button>
  );
}
