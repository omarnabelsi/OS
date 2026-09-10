/**
 * What a folder window shows.
 *
 * Three layouts, chosen per folder and stored on it: `grid` (artwork tiles), `list` (a dense
 * row per item, which is the only one that works for a folder of hundreds) and `covers` (large
 * artwork, nothing else). The layout is data on the folder, not a mode of this component, so a
 * theme or the folder editor can set it and it persists.
 *
 * All three folder kinds land here. `folder_contents` already resolves them - a smart folder
 * runs its saved filter, a collection reads its members - so the only difference this file
 * makes is the empty state, which has to say something true about *why* it is empty.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FolderLayout, FolderWindowState, LibraryItem } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useDesktopStore, useLibraryStore, useUiStore } from '@/store';
import { useWmStore, type WindowInstance } from '@/wm';

import { Icon, type IconName } from '../Icon';
import { placeholderHue, Tile } from '../Tile';

/** How long a window must sit still before its geometry is written. */
const SETTLE_MS = 700;

const LAYOUTS: ReadonlyArray<{ id: FolderLayout; icon: IconName; label: string }> = [
  { id: 'grid', icon: 'apps', label: 'Grid' },
  { id: 'list', icon: 'list', label: 'List' },
  { id: 'covers', icon: 'image', label: 'Covers' },
];

export function FolderWindowBody({ window: win }: { window: WindowInstance }): React.JSX.Element {
  const folder = useDesktopStore((s) => s.folderById(win.targetId));
  const folderContents = useDesktopStore((s) => s.folderContents);
  const patchFolder = useDesktopStore((s) => s.patchFolder);
  const rememberWindowState = useDesktopStore((s) => s.rememberWindowState);
  // Re-reading when the library changes keeps a smart folder honest: favouriting something has
  // to show up in "Favourites" without reopening the window.
  const libraryItems = useLibraryStore((s) => s.items);
  const launch = useLibraryStore((s) => s.launch);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const openWindow = useWmStore((s) => s.open);

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const targetId = win.targetId;

  useEffect(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void folderContents(targetId)
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, folderContents, libraryItems]);

  /*
   * Persist the window's geometry, but only once it has stopped moving.
   *
   * A drag produces a rect per frame and each one would otherwise be a database write. The
   * timer restarts on every change, so exactly one write happens per gesture; the cleanup
   * flushes, because minimising or closing unmounts this component and that is precisely the
   * geometry worth remembering.
   */
  const geometry = useMemo<FolderWindowState>(
    () => ({
      x: Math.round(win.rect.x),
      y: Math.round(win.rect.y),
      width: Math.round(win.rect.width),
      height: Math.round(win.rect.height),
      maximised: win.mode === 'maximised',
    }),
    [win.rect.x, win.rect.y, win.rect.width, win.rect.height, win.mode],
  );

  const latest = useRef(geometry);
  latest.current = geometry;
  // The geometry the window opened with. Writing that back would be a pointless round trip.
  const opened = useRef(geometry);
  const dirty = useRef(false);

  useEffect(() => {
    if (!targetId) return;
    if (sameGeometry(geometry, opened.current)) return;
    dirty.current = true;
    const timer = setTimeout(() => {
      dirty.current = false;
      void rememberWindowState(targetId, latest.current);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [geometry, targetId, rememberWindowState]);

  useEffect(() => {
    // Unmount only - the closing or minimising window's last position.
    return () => {
      if (dirty.current && targetId) void rememberWindowState(targetId, latest.current);
    };
  }, [targetId, rememberWindowState]);

  const layout: FolderLayout = folder?.layout ?? 'grid';

  const activate = useCallback(
    (item: LibraryItem) => {
      setFocusedItem(item.id);
      void launch(item.id);
    },
    [launch, setFocusedItem],
  );

  const group = `window:${win.id}`;

  return (
    <div className="aura-folder" data-layout={layout}>
      <div className="aura-folder-bar">
        <span className="aura-folder-count">
          {loading ? 'Loading…' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        </span>

        <div className="aura-folder-tools">
          {LAYOUTS.map((option) => (
            <LayoutButton
              key={option.id}
              group={group}
              icon={option.icon}
              label={option.label}
              active={layout === option.id}
              onPick={() => {
                if (folder) void patchFolder(folder.id, { layout: option.id });
              }}
            />
          ))}
          <LayoutButton
            group={group}
            icon="settings"
            label="Edit folder"
            active={false}
            onPick={() => {
              if (!folder) return;
              // The editor is a window of its own rather than a modal: the point of it is the
              // live preview, and you want the folder you are editing still visible beside it.
              openWindow({
                kind: 'folderEditor',
                targetId: folder.id,
                title: `Edit ${folder.label ?? 'folder'}`,
                icon: 'settings',
                size: { width: 460, height: 580 },
              });
            }}
          />
        </div>
      </div>

      <div className="aura-folder-body">
        {loading ? (
          <p className="aura-window-note">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyFolder kind={folder?.kind} />
        ) : layout === 'list' ? (
          <div className="aura-folder-list">
            {items.map((item) => (
              <ListRow key={item.id} item={item} group={group} onActivate={activate} />
            ))}
          </div>
        ) : (
          <div className="aura-grid">
            {items.map((item) => (
              <Tile
                key={item.id}
                rowId={`window-${win.id}`}
                // Everything inside a window belongs to that window's focus group, so a D-pad
                // cannot wander into the window behind it (docs/RISKS.md R11).
                group={group}
                item={item}
                onActivate={activate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function sameGeometry(a: FolderWindowState, b: FolderWindowState): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.maximised === b.maximised
  );
}

function LayoutButton({
  group,
  icon,
  label,
  active,
  onPick,
}: {
  group: string;
  icon: IconName;
  label: string;
  active: boolean;
  onPick(): void;
}): React.JSX.Element {
  const { ref, props } = useFocusable({ id: `${group}:tool:${label}`, group, onActivate: onPick });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-folder-tool"
      data-active={active || undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...props}
    >
      <Icon name={icon} size="1em" />
    </button>
  );
}

/** A dense row. The only layout that stays usable for a folder with hundreds of entries. */
function ListRow({
  item,
  group,
  onActivate,
}: {
  item: LibraryItem;
  group: string;
  onActivate(item: LibraryItem): void;
}): React.JSX.Element {
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  // `props` already carries `data-focused`; the engine owns that attribute.
  const { ref, props } = useFocusable({
    id: `row:${group}:${item.id}`,
    group,
    onActivate: () => onActivate(item),
    onFocus: () => setFocusedItem(item.id),
  });

  const art = assetUrl(item.artwork.icon ?? item.artwork.grid ?? undefined);
  const hue = placeholderHue(item.name);

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-folder-row"
      {...props}
    >
      <span className="aura-folder-row-art" style={{ background: `hsl(${hue} 40% 22%)` }}>
        {art ? <img src={art} alt="" loading="lazy" draggable={false} /> : null}
      </span>
      <span className="aura-folder-row-name">{item.name}</span>
      {item.stats.favourite ? (
        <Icon name="star" size="0.85em" title="Favourite" />
      ) : null}
      <span className="aura-folder-row-meta">{playtime(item.stats.playtimeSecs)}</span>
    </button>
  );
}

function playtime(seconds: number): string {
  if (seconds <= 0) return 'Never played';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

/**
 * Empty states differ by kind because the *reason* differs, and a user cannot act on "nothing
 * here" without knowing which one it is.
 */
function EmptyFolder({ kind }: { kind?: string }): React.JSX.Element {
  if (kind === 'filesystem') {
    return (
      <div className="aura-empty">
        <h2>Not browsable yet</h2>
        <p>Real folders on disk arrive with the file service in V2. This folder remembers its path.</p>
      </div>
    );
  }
  if (kind === 'collection') {
    return (
      <div className="aura-empty">
        <h2>This collection is empty</h2>
        <p>Add games and apps to it from their item menu.</p>
      </div>
    );
  }
  return (
    <div className="aura-empty">
      <h2>Nothing matches</h2>
      <p>This folder shows whatever fits its filter, and right now nothing does.</p>
    </div>
  );
}
