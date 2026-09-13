/**
 * The desktop: a free-placement surface with items the user put where they wanted them.
 *
 * This component owns the only conversion between stored **cells** and screen **pixels**. The
 * store and the core never see a pixel, which is what lets an arrangement made at 1080p survive
 * a 4K monitor: the strides change and the stored positions do not.
 *
 * The grid is not square. A folder is 216 wide and up to 168 tall with its label, so the cell is
 * 259 x 240 including gaps - seven of which span 1920 inside a 64px margin. The strides come from
 * theme tokens, read here rather than hard-coded, so a theme can loosen or tighten the whole
 * composition without a code change.
 *
 * Drag lifecycle: an item reports pointer deltas, the surface previews the landing cell, and only
 * the drop writes - one `update_desktop_item` per gesture, never one per frame.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { DesktopItem } from '@/bridge';
import { useFocus } from '@/focus';
import { useDesktopStore, useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';
import { useWmStore } from '@/wm';

import { isIconName } from '../Icon';
import { DesktopIcon } from './DesktopIcon';
import { Folder } from './Folder';
import {
  cellSize,
  cellToPx,
  desktopBounds,
  placeForDisplay,
  pxToCell,
  resolveDrop,
  type DesktopMetrics,
} from './grid';
import { useDragGesture } from './useDragGesture';
import { Widget } from './widgets';

interface DragState {
  item: DesktopItem;
  dx: number;
  dy: number;
  /** Where it would land if dropped now. */
  target: { x: number; y: number };
}

/** The design's grid, used until the tokens have been read. */
const FALLBACK = { strideX: 259, strideY: 240, gapX: 24, gapY: 40 };

/**
 * Read the grid out of the theme's tokens.
 *
 * Computed style rather than the token JSON, because a theme's own `theme.css` may override these
 * and the browser is the only thing that knows the final value.
 */
function readGrid(element: HTMLElement): typeof FALLBACK {
  const styles = getComputedStyle(element);
  const num = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    strideX: num('--desktop-grid-cell-w', FALLBACK.strideX),
    strideY: num('--desktop-grid-cell-h', FALLBACK.strideY),
    gapX: num('--desktop-column-gap', FALLBACK.gapX),
    gapY: num('--desktop-row-gap', FALLBACK.gapY),
  };
}

export function DesktopSurface(): React.JSX.Element {
  const { bundle } = useTheme();
  const desktops = useDesktopStore((s) => s.desktops);
  const activeId = useDesktopStore((s) => s.activeId);
  const items = useDesktopStore((s) => s.items);
  const loaded = useDesktopStore((s) => s.loaded);
  const folders = useDesktopStore((s) => s.folders);
  const folderById = useDesktopStore((s) => s.folderById);
  const folderContents = useDesktopStore((s) => s.folderContents);
  const moveItem = useDesktopStore((s) => s.moveItem);
  const byId = useLibraryStore((s) => s.byId);
  const libraryItems = useLibraryStore((s) => s.items);
  const launch = useLibraryStore((s) => s.launch);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const showSnapGrid = useUiStore((s) => s.showSnapGrid);
  const openWindow = useWmStore((s) => s.open);
  // Peers dim only for focus the user placed with the D-pad or keyboard. The engine's own
  // placement on boot, and a pointer hovering, leave the desktop at rest - see `FocusSource`.
  const { focusedId: engineFocusedId, focusSource } = useFocus();
  const focusedId = focusSource === 'nav' ? engineFocusedId : null;
  // "Tile scale" resizes the grid cell itself (tokens.ts), so a change has to force a remeasure -
  // the ResizeObserver below fires on the surface's own box changing, not on a custom property.
  const tileScale = useSettingsStore((s) => s.settings?.tileScale ?? 1);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [grid, setGrid] = useState(FALLBACK);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const desktop = desktops.find((d) => d.id === activeId);
  // Snapping is the desktop's own setting; the strides are the theme's.
  const snap = desktop?.grid.snap ?? bundle?.layout?.desktop?.grid?.snap ?? true;

  // Measured rather than assumed: how many cells fit decides where a drop can land.
  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      setGrid(readGrid(element));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bundle?.tokens, tileScale]);

  const metrics = useMemo<DesktopMetrics>(() => {
    const bounds = desktopBounds(grid, size.width, size.height);
    return { ...grid, ...bounds, snap };
  }, [grid, size.width, size.height, snap]);

  const bounds = { columns: metrics.columns, rows: metrics.rows };
  const cell = cellSize(metrics);

  // Where each item is *drawn*: an item stored off the edge of a smaller display is pulled into
  // view without its stored cell being touched. See `placeForDisplay`.
  const placed = useMemo(
    () => placeForDisplay(items, bounds),
    [items, bounds.columns, bounds.rows],
  );

  /*
   * How many entries each folder holds, for the meta line under its label.
   *
   * One query per folder, once - not per render and not per frame. Re-run when the library
   * changes, because a smart folder's count is a view of it: scanning in twenty games has to
   * show up under "Games" without a restart.
   */
  useEffect(() => {
    let cancelled = false;
    const wanted = folders.filter((f) => items.some((i) => i.targetId === f.id));
    if (wanted.length === 0) return;

    void Promise.all(
      wanted.map(async (folder) => {
        try {
          return [folder.id, (await folderContents(folder.id)).length] as const;
        } catch {
          // A folder whose contents cannot be read shows no count rather than a zero.
          return [folder.id, null] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setCounts(
        Object.fromEntries(pairs.filter((p): p is readonly [string, number] => p[1] !== null)),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [folders, items, folderContents, libraryItems]);

  const onDragStart = useCallback((item: DesktopItem) => {
    setDrag({ item, dx: 0, dy: 0, target: { x: item.x, y: item.y } });
  }, []);

  const onDragMove = useCallback(
    (dx: number, dy: number) => {
      setDrag((current) => {
        if (!current) return current;
        const { item } = current;
        // Where the item's top-left now sits, in pixels, then back to a cell.
        const px = cellToPx(metrics.strideX, item.x) + dx;
        const py = cellToPx(metrics.strideY, item.y) + dy;
        const desired = metrics.snap
          ? { x: pxToCell(metrics.strideX, px), y: pxToCell(metrics.strideY, py) }
          : { x: item.x, y: item.y };
        return { ...current, dx, dy, target: resolveDrop(item, desired, items, bounds) };
      });
    },
    [metrics.strideX, metrics.strideY, metrics.snap, items, bounds],
  );

  const onDragEnd = useCallback(() => {
    setDrag((current) => {
      if (current) {
        const { item, target } = current;
        // One write per gesture, on drop - not per frame.
        if (target.x !== item.x || target.y !== item.y) {
          void moveItem(item.id, target.x, target.y);
        }
      }
      return null;
    });
  }, [moveItem]);

  const activate = useCallback(
    (item: DesktopItem) => {
      if (item.kind === 'folder' && item.targetId) {
        const folder = folderById(item.targetId);
        const saved = folder?.windowState ?? null;

        /*
         * Where the window should appear to grow from: the middle of the folder just activated.
         *
         * Computed from the same cell arithmetic that drew the folder rather than by measuring
         * the DOM, so it is right for a folder that was pulled into view on a small display too.
         */
        const field = surfaceRef.current?.getBoundingClientRect();
        const at = placed.get(item.id) ?? { x: item.x, y: item.y };
        const origin = field
          ? {
              x: field.left + cellToPx(metrics.strideX, at.x) + cell.width / 2,
              y: field.top + cellToPx(metrics.strideY, at.y) + cell.height / 2,
            }
          : null;

        // What kind of folder this is, which is the one thing about it the title does not say.
        const subtitle =
          folder?.kind === 'smart'
            ? 'Smart folder'
            : folder?.kind === 'collection'
              ? 'Collection'
              : folder?.kind === 'filesystem'
                ? 'Folder on disk'
                : null;

        // `open` raises the existing window if this folder is already showing, rather than
        // stacking a second identical one.
        openWindow({
          kind: 'folder',
          targetId: item.targetId,
          title: item.labelOverride ?? folder?.label ?? 'Folder',
          subtitle,
          // `folder.icon` may be a custom image path rather than a theme icon key (11d) - the
          // title bar only draws named glyphs, so anything else falls back the way "no icon" did.
          icon: folder?.icon && isIconName(folder.icon) ? folder.icon : 'files',
          // Ink unless the folder was explicitly tinted (11a) - never a hardcoded accent here.
          iconColor: folder?.color ?? null,
          origin,
          size: { width: 1300, height: 790 },
          // A folder reopens where it was left. `constrainToDesktop` still applies, so a
          // position saved on a larger monitor cannot strand the window off-screen.
          ...(saved
            ? {
                rect: { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
                mode: saved.maximised ? ('maximised' as const) : ('normal' as const),
              }
            : {}),
        });
        return;
      }
      if (item.kind === 'shortcut' && item.targetId) {
        setFocusedItem(item.targetId);
        void launch(item.targetId);
      }
    },
    // `placed`, the strides and the cell size are read for the window's growth origin, so a
    // stale closure here would grow the window out of where a folder used to be.
    [
      folderById,
      launch,
      openWindow,
      setFocusedItem,
      placed,
      metrics.strideX,
      metrics.strideY,
      cell.width,
      cell.height,
    ],
  );

  if (loaded && !desktop) {
    return (
      <div className="aura-empty">
        <h2>No desktop yet</h2>
        <p>Aura Shell could not load a desktop to show. Try restarting the app.</p>
      </div>
    );
  }

  /** An item's box, in pixels, at the cell it is *drawn* in. Spans include the gaps they swallow. */
  const boxStyle = (item: DesktopItem): React.CSSProperties => {
    const at = placed.get(item.id) ?? { x: item.x, y: item.y };
    return {
      transform: `translate3d(${cellToPx(metrics.strideX, at.x)}px, ${cellToPx(
        metrics.strideY,
        at.y,
      )}px, 0)`,
      width: cell.width + (item.width - 1) * metrics.strideX,
      height: cell.height + (item.height - 1) * metrics.strideY,
    };
  };

  return (
    <div
      className="aura-desktop"
      data-snap={metrics.snap || undefined}
      // Peers dim while a desktop item holds focus - see folder.css.
      data-focus-within={focusedId?.startsWith('desktop:') || undefined}
      style={
        {
          '--desktop-stride-x': `${metrics.strideX}px`,
          '--desktop-stride-y': `${metrics.strideY}px`,
        } as React.CSSProperties
      }
    >
      {/*
        The placeable area, inset by the screen margin, and what gets measured. An absolutely
        positioned child is laid out against the padding box, so padding on `.aura-desktop` would
        not have inset anything - and `clientWidth` would have counted the margin as usable, so
        the grid would have believed two more columns fit than do.
      */}
      <div ref={surfaceRef} className="aura-desktop-field">
      {/*
        The snap grid (Ctrl+Shift+G). Drawn from the same strides the drop maths uses, so if the
        lines and the landing cell ever disagree, the overlay is telling the truth about the bug.
      */}
      {showSnapGrid ? (
        <div
          className="aura-desktop-snap"
          aria-hidden="true"
          style={{
            width: metrics.columns * metrics.strideX - metrics.gapX,
            height: metrics.rows * metrics.strideY - metrics.gapY,
          }}
        />
      ) : null}

      {/* The cell the dragged item would land in. Purely a preview; no state is written. */}
      {drag ? (
        <div
          className="aura-desktop-drop"
          style={boxStyle({ ...drag.item, x: drag.target.x, y: drag.target.y })}
        />
      ) : null}

      {items.map((item) => (
        <div
          key={item.id}
          className="aura-desktop-cell"
          data-kind={item.kind}
          style={{
            ...boxStyle(item),
            // The dragged item rides above its neighbours.
            zIndex: drag?.item.id === item.id ? 2 : undefined,
          }}
        >
          {item.kind === 'folder' ? (
            <Folder
              item={item}
              folder={folderById(item.targetId)}
              count={item.targetId ? (counts[item.targetId] ?? null) : null}
              dragOffset={drag?.item.id === item.id ? { dx: drag.dx, dy: drag.dy } : null}
              onActivate={() => activate(item)}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          ) : item.kind === 'widget' ? (
            <DesktopWidget
              item={item}
              dragOffset={drag?.item.id === item.id ? { dx: drag.dx, dy: drag.dy } : null}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          ) : (
            <DesktopIcon
              item={item}
              folder={undefined}
              entry={item.targetId ? byId[item.targetId] : undefined}
              dragOffset={drag?.item.id === item.id ? { dx: drag.dx, dy: drag.dy } : null}
              onActivate={() => activate(item)}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * A widget in a cell: draggable like everything else, but not a focus stop.
 *
 * Deliberately not focusable. A widget has nothing to activate, so a D-pad stop on the clock
 * would be a dead end between two folders - and "the D-pad moves between folders predictably" is
 * worth more than being able to highlight a clock. The pointer can still move it.
 */
function DesktopWidget({
  item,
  dragOffset,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: DesktopItem;
  dragOffset: { dx: number; dy: number } | null;
  onDragStart(item: DesktopItem, pointerId: number): void;
  onDragMove(dx: number, dy: number): void;
  onDragEnd(): void;
}): React.JSX.Element {
  const gesture = useDragGesture({
    item,
    // Nothing to activate: a click on a widget is a click on whatever it drew.
    onActivate: () => {},
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  return (
    <div
      className="aura-desktop-widget"
      data-dragging={gesture.dragging || undefined}
      style={
        dragOffset
          ? { transform: `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)` }
          : undefined
      }
      {...gesture.handlers}
    >
      <Widget id={item.targetId} />
    </div>
  );
}
