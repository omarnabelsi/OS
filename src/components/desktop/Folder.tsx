/**
 * A folder on the desktop: artwork, label, meta, and the four states.
 *
 * The centrepiece of the shell, so three things here are deliberate and worth not undoing.
 *
 * **The scale is on the wrapper, not the artwork.** A focused folder grows to 1.06. Scaling only
 * the artwork would grow it *downwards into the label* - the label sits a fixed 14px below, so
 * artwork that grows from its own centre eats that gap and covers the text. Scaling the wrapper
 * moves artwork and label together, and the gap survives every scale, tile size and UI scale.
 *
 * **The artwork sits in a fixed-height slot.** The three shapes are different heights (152, 104,
 * and 152 under a 16px tab), and a capsule is pushed down 24px so its optical centre lines up
 * with its neighbours. Laid out naively, each shape would put its label at a different height and
 * a row of mixed folders would look broken. The slot is constant; the shape floats inside it.
 *
 * **Peers dim while one folder is focused.** The surface marks itself when anything in the
 * desktop group holds focus, and every folder that is not the focused one drops to 68%. It is the
 * awkward signal to implement and the one that makes focus readable from across a room - ring,
 * bloom, lift and dim all say the same thing at different distances.
 *
 * The shape is theme data (`folderShape.ts`), not a branch here: three shapes today because
 * `aura-default` declares three, and a fourth is an entry in a theme.
 */

import { useMemo } from 'react';

import type { DesktopItem, Folder as FolderRecord } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useSettingsStore } from '@/store';
import { Surface } from '@/surface';

import { Icon, isIconName } from '../Icon';
import { pickShape, resolveGeometry } from './folderShape';
import { useFolderShapes } from './FolderGlyph';
import { useDragGesture } from './useDragGesture';

export interface FolderProps {
  item: DesktopItem;
  folder: FolderRecord | undefined;
  /** How many entries the folder holds, or null while that is still unknown. */
  count: number | null;
  /** Live pixel offset while dragging, or null. Owned by the surface. */
  dragOffset: { dx: number; dy: number } | null;
  /**
   * Focus group. The desktop by default; the folder editor's live preview passes its window's
   * group so a preview inside a window is not registered as a desktop item.
   */
  group?: string;
  /**
   * False for a preview: it is an illustration of a folder, not a folder. It does not take focus,
   * does not drag, and does not answer the pointer - but it is the same component, which is the
   * whole point of the editor's preview.
   */
  interactive?: boolean;
  onActivate?(): void;
  onDragStart?(item: DesktopItem, pointerId: number): void;
  onDragMove?(dx: number, dy: number): void;
  onDragEnd?(): void;
}

const noop = () => {};

/** A geometry pixel value times the tile-scale setting, rounded to a tenth of a pixel. */
function scalePx(value: number, scale: number): number {
  return Math.round(value * scale * 10) / 10;
}

export function Folder({
  item,
  folder,
  count,
  dragOffset,
  group = 'desktop',
  interactive = true,
  onActivate = noop,
  onDragStart = noop,
  onDragMove = noop,
  onDragEnd = noop,
}: FolderProps): React.JSX.Element {
  const shapes = useFolderShapes();
  const rawTileScale = useSettingsStore((s) => s.settings?.tileScale ?? 1);
  // "Tile scale" reads as "folder size" from the desktop - clamped defensively, same range
  // `cssVariables` enforces for the root `--tile-scale` this must move in lockstep with.
  const tileScale = Math.min(1.3, Math.max(0.8, rawTileScale));

  const geometry = useMemo(
    () => resolveGeometry(pickShape(shapes, folder?.shape)),
    [shapes, folder?.shape],
  );

  const {
    ref,
    visible: focused,
    props: focusProps,
  } = useFocusable({
    id: `desktop:${item.id}`,
    group,
    // A preview registers, but is never a stop: the editor's pane is not somewhere focus lives.
    disabled: !interactive,
    onActivate,
  });
  /*
   * The lift, ring, bloom, e3 and the peers dimming are for focus the user can see they placed -
   * the D-pad or the keyboard. A pointer resting on a folder gets the hover state instead, and the
   * engine's own placement on boot shows nothing: at rest every folder is at full opacity with no
   * ring. The engine still knows which folder is focused either way.
   */
  const props = { ...focusProps, 'data-focused': focused || undefined };

  /*
   * The gesture activates through `props.onClick`, not through `onActivate` directly: the focus
   * engine's handler moves focus here *and then* activates, so going around it would open a
   * folder that the engine still thinks is unfocused.
   */
  const gesture = useDragGesture({
    item,
    onActivate: props.onClick,
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  const label = item.labelOverride ?? folder?.label ?? 'Untitled';
  const cover = folder?.cover ? assetUrl(folder.cover) : undefined;
  const tint = folder?.color ?? undefined;

  // `icon` is either a theme icon key or a user-picked image path (11d) - the two share a column,
  // so a value that is not one of the active theme's known names is resolved as a path instead,
  // through the same `assetUrl` the cover above already goes through.
  const iconValue = item.iconOverride ?? folder?.icon ?? undefined;
  const knownIcon = iconValue && isIconName(iconValue) ? iconValue : undefined;
  const customIcon = iconValue && !knownIcon ? assetUrl(iconValue) : undefined;

  /*
   * All four states are CSS, driven by the data attributes below. They all animate the same
   * properties, and the token durations are already there - `--duration-fast` for hover and
   * press, `--duration-base` for focus - so reduced motion is honoured for free: the tokens go to
   * 0ms and the states still apply, they just arrive instantly.
   */
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-folder"
      {...props}
      data-pressed={gesture.pressed || undefined}
      data-dragging={gesture.dragging || undefined}
      data-shape={geometry.id}
      data-tinted={tint ? true : undefined}
      data-covered={cover ? true : undefined}
      aria-label={label}
      title={label}
      style={
        {
          // Width comes from the theme's own `--folder-art-width`, already scaled by
          // `--tile-scale` at the root (tokens.ts) - height, offset and the tab are per-shape
          // numbers computed here, so they scale locally by the same factor to match. Rounded to
          // a tenth of a pixel so a scale like 1.2 does not write JS float noise into the DOM.
          '--folder-art-height': `${scalePx(geometry.height, tileScale)}px`,
          '--folder-art-radius': geometry.radius,
          '--folder-art-offset': `${scalePx(geometry.offsetTop, tileScale)}px`,
          ...(geometry.tab
            ? {
                '--folder-tab-width': `${scalePx(geometry.tab.width, tileScale)}px`,
                '--folder-tab-height': `${scalePx(geometry.tab.height, tileScale)}px`,
                '--folder-tab-radius': geometry.tab.radius,
              }
            : {}),
          ...(tint ? { '--folder-tint': tint } : {}),
          ...(dragOffset
            ? { transform: `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)` }
            : {}),
        } as React.CSSProperties
      }
      {...gesture.handlers}
    >
      <span className="aura-folder-art">
        {/* A tab, when the theme's shape declares one. Drawn rather than masked, so it tints. */}
        {geometry.tab ? <span className="aura-folder-tab" /> : null}

        {/*
          The body is the raised surface: it carries the level's shadow and whatever blur the
          budget grants it. e1 at rest, e3 while focused - the design's "focused folder rises" -
          and the level change moves it up the blur budget's priority order at the same time.
        */}
        <Surface level={focused ? 'e3' : 'e1'} as="span" className="aura-folder-body">
          {cover ? (
            <>
              <img className="aura-folder-cover" src={cover} alt="" draggable={false} />
              {/* Keeps the icon legible over an arbitrary image. */}
              <span className="aura-folder-cover-scrim" />
            </>
          ) : null}

          {!cover && customIcon ? (
            <img
              className="aura-folder-icon aura-folder-icon-image"
              src={customIcon}
              alt=""
              draggable={false}
            />
          ) : (
            <span className="aura-folder-icon">
              <Icon name={knownIcon || 'files'} size="1em" />
            </span>
          )}
        </Surface>
      </span>

      <span className="aura-folder-label aura-type-folder-label">{label}</span>
      {/* Empty rather than absent while the count is still loading: the row must not reflow. */}
      <span className="aura-folder-meta aura-type-folder-meta">
        {count === null ? ' ' : `${count} ${count === 1 ? 'item' : 'items'}`}
      </span>
    </button>
  );
}
