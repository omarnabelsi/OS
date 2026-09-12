/**
 * A shortcut on the desktop: an entry from the library, placed in a cell.
 *
 * Folders are not drawn by this component - they are the desktop's centrepiece and have their own
 * (`Folder.tsx`), with three shapes, a tint, cover art and a four-state machine. What is left
 * here is the plain case: an icon and a label.
 *
 * The press-or-drag gesture is shared with the folder through `useDragGesture`, so the threshold,
 * the pointer capture and the suppressed click after a drag behave identically for both.
 */

import { motion } from 'framer-motion';

import type { DesktopItem, Folder, LibraryItem } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useSettingsStore } from '@/store';
import { Surface } from '@/surface';

import { Icon } from '../Icon';
import { FolderGlyph } from './FolderGlyph';
import { useDragGesture } from './useDragGesture';

export { DRAG_THRESHOLD_PX } from './useDragGesture';

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

  const label = item.labelOverride ?? folder?.label ?? entry?.name ?? 'Untitled';

  const { ref, focused, props } = useFocusable({
    id: `desktop:${item.id}`,
    group: 'desktop',
    onActivate,
  });

  /*
   * Activation goes through `props.onClick`, not `onActivate` directly: the focus engine's
   * handler moves focus here *and then* activates, so bypassing it would launch something the
   * engine still believes is unfocused.
   */
  const gesture = useDragGesture({
    item,
    onActivate: props.onClick,
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  const art = entry ? assetUrl(entry.artwork.icon ?? entry.artwork.grid ?? undefined) : undefined;

  return (
    <Surface
      level="e1"
      as={motion.button}
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-desktop-icon"
      data-dragging={gesture.dragging || undefined}
      title={label}
      animate={{ scale: focused && !reduceMotion && !gesture.dragging ? 1.06 : 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
      style={
        dragOffset
          ? { transform: `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)` }
          : undefined
      }
      {...props}
      {...gesture.handlers}
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
    </Surface>
  );
}
