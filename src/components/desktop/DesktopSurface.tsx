/**
 * The desktop: a wallpaper with items the user placed on it.
 *
 * This component owns the only conversion between stored **cells** and screen **pixels**. The
 * store and the core never see a pixel, which is what lets an arrangement made at 1080p survive
 * a 4K monitor - the cell size changes and the stored positions do not.
 *
 * Drag lifecycle: `DesktopIcon` reports pointer deltas, the surface previews the landing cell,
 * and only the drop writes - one `update_desktop_item` per gesture, never one per frame.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { DesktopItem } from '@/bridge';
import { useDesktopStore, useLibraryStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';
import { useWmStore } from '@/wm';

import type { IconName } from '../Icon';
import { DesktopIcon } from './DesktopIcon';
import { cellToPixels, gridBounds, pixelsToCell, resolveDrop } from './grid';

interface DragState {
  item: DesktopItem;
  dx: number;
  dy: number;
  /** Where it would land if dropped now. */
  target: { x: number; y: number };
}

export function DesktopSurface(): React.JSX.Element {
  const { bundle } = useTheme();
  const desktops = useDesktopStore((s) => s.desktops);
  const activeId = useDesktopStore((s) => s.activeId);
  const items = useDesktopStore((s) => s.items);
  const loaded = useDesktopStore((s) => s.loaded);
  const folderById = useDesktopStore((s) => s.folderById);
  const moveItem = useDesktopStore((s) => s.moveItem);
  const byId = useLibraryStore((s) => s.byId);
  const launch = useLibraryStore((s) => s.launch);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const openWindow = useWmStore((s) => s.open);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);

  const desktop = desktops.find((d) => d.id === activeId);
  // The theme's grid is the fallback for a desktop that has not been given its own.
  const themeGrid = bundle?.layout?.desktop?.grid;
  const grid = desktop?.grid ?? {
    cell: themeGrid?.cell ?? 96,
    gap: themeGrid?.gap ?? 16,
    snap: themeGrid?.snap ?? true,
    autoArrange: false,
  };

  /*
   * The desktop deliberately does **not** claim a focus scope yet.
   *
   * Scoping is the answer to overlapping windows (docs/RISKS.md R11), but it also seals the pool
   * off: scoping to `desktop` today would make the nav bar unreachable by D-pad, because the
   * action that moves focus *between* scopes arrives with the window manager in phase 3. A flat
   * surface needs no scope, so it gets none until the thing that needs it exists.
   *
   * Focus still lands here rather than on the nav bar: `FocusProvider` re-homes auto-placed
   * focus off chrome onto whatever surface is showing.
   */

  // Measured rather than assumed: the number of cells that fit decides where a drop can land.
  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bounds = gridBounds(grid, size.width, size.height);

  const onDragStart = useCallback((item: DesktopItem) => {
    setDrag({ item, dx: 0, dy: 0, target: { x: item.x, y: item.y } });
  }, []);

  const onDragMove = useCallback(
    (dx: number, dy: number) => {
      setDrag((current) => {
        if (!current) return current;
        const { item } = current;
        // Where the icon's top-left now sits, in pixels, then back to a cell.
        const px = cellToPixels(grid.cell, grid.gap, item.x) + dx;
        const py = cellToPixels(grid.cell, grid.gap, item.y) + dy;
        const desired = grid.snap
          ? { x: pixelsToCell(grid.cell, grid.gap, px), y: pixelsToCell(grid.cell, grid.gap, py) }
          : { x: item.x, y: item.y };
        return { ...current, dx, dy, target: resolveDrop(item, desired, items, bounds) };
      });
    },
    [grid.cell, grid.gap, grid.snap, items, bounds],
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
        // `open` raises the existing window if this folder is already showing, rather than
        // stacking a second identical one.
        openWindow({
          kind: 'folder',
          targetId: item.targetId,
          title: item.labelOverride ?? folder?.label ?? 'Folder',
          icon: (folder?.icon as IconName | undefined) ?? 'files',
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
    [folderById, launch, openWindow, setFocusedItem],
  );

  if (loaded && !desktop) {
    return (
      <div className="aura-empty">
        <h2>No desktop yet</h2>
        <p>Aura Shell could not load a desktop to show. Try restarting the app.</p>
      </div>
    );
  }

  return (
    <div
      ref={surfaceRef}
      className="aura-desktop"
      data-snap={grid.snap || undefined}
      style={
        {
          '--desktop-cell': `${grid.cell}px`,
          '--desktop-gap': `${grid.gap}px`,
        } as React.CSSProperties
      }
    >
      {/* The cell the dragged item would land in. Purely a preview; no state is written. */}
      {drag ? (
        <div
          className="aura-desktop-drop"
          style={{
            transform: `translate3d(${cellToPixels(grid.cell, grid.gap, drag.target.x)}px, ${cellToPixels(
              grid.cell,
              grid.gap,
              drag.target.y,
            )}px, 0)`,
            width: `calc(var(--desktop-cell) * ${drag.item.width} + var(--desktop-gap) * ${drag.item.width - 1})`,
            height: `calc(var(--desktop-cell) * ${drag.item.height} + var(--desktop-gap) * ${drag.item.height - 1})`,
          }}
        />
      ) : null}

      {items.map((item) => (
        <div
          key={item.id}
          className="aura-desktop-cell"
          style={{
            transform: `translate3d(${cellToPixels(grid.cell, grid.gap, item.x)}px, ${cellToPixels(
              grid.cell,
              grid.gap,
              item.y,
            )}px, 0)`,
            width: `calc(var(--desktop-cell) * ${item.width} + var(--desktop-gap) * ${item.width - 1})`,
            height: `calc(var(--desktop-cell) * ${item.height} + var(--desktop-gap) * ${item.height - 1})`,
            // The dragged icon rides above its neighbours.
            zIndex: drag?.item.id === item.id ? 2 : undefined,
          }}
        >
          <DesktopIcon
            item={item}
            folder={item.kind === 'folder' ? folderById(item.targetId) : undefined}
            entry={item.kind === 'shortcut' && item.targetId ? byId[item.targetId] : undefined}
            dragOffset={drag?.item.id === item.id ? { dx: drag.dx, dy: drag.dy } : null}
            onActivate={() => activate(item)}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
          />
        </div>
      ))}
    </div>
  );
}
