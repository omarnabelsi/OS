/**
 * A library tile and the horizontal rows they sit in.
 *
 * The focused tile scales up and pushes its dominant colour into `--accent-bleed`, which the
 * theme uses for the tile glow and the background wash. Motion is spring-based (the console
 * feel) and collapses to nothing when the user has asked for reduced motion.
 */

import { motion } from 'framer-motion';
import { useMemo } from 'react';

import type { LibraryItem } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';

import { Icon } from './Icon';

/** Stable pleasant colour from a name, for tiles that have no artwork yet. */
export function placeholderHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export interface TileProps {
  item: LibraryItem;
  /** Distinguishes the same item appearing in two rows on the home screen. */
  rowId: string;
  onActivate(item: LibraryItem): void;
}

export function Tile({ item, rowId, onActivate }: TileProps): React.JSX.Element {
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);

  const { ref, focused, props } = useFocusable({
    id: `tile:${rowId}:${item.id}`,
    group: 'content',
    onActivate: () => onActivate(item),
    onFocus: () => setFocusedItem(item.id),
  });

  const art = assetUrl(item.artwork.grid ?? item.artwork.hero ?? undefined);
  const hue = useMemo(() => placeholderHue(item.name), [item.name]);

  return (
    // The label lives outside the button so the theme's focus ring hugs the artwork rather
    // than enclosing a caption that is only visible while focused.
    <div className="aura-tile-wrap" data-focused={focused || undefined}>
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className="aura-tile"
        title={item.name}
        animate={{ scale: focused && !reduceMotion ? 1.08 : 1 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
        style={
          focused
            ? ({ '--accent-bleed': `hsl(${hue} 70% 60%)` } as React.CSSProperties)
            : undefined
        }
        {...props}
      >
        <div className="aura-tile-art">
          {art ? (
            <img src={art} alt="" loading="lazy" draggable={false} />
          ) : (
            <div
              className="aura-tile-placeholder"
              style={{
                background: `linear-gradient(160deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 50% 12%))`,
              }}
            >
              <span>{item.name}</span>
            </div>
          )}

          {item.stats.favourite ? (
            <span className="aura-tile-badge" title="Favourite">
              <Icon name="star" size="0.85em" />
            </span>
          ) : null}
        </div>
      </motion.button>

      <span className="aura-tile-label">{item.name}</span>
    </div>
  );
}

export interface TileRowProps {
  id: string;
  title: string;
  items: LibraryItem[];
  /** Shown instead of the row when it has no items. */
  emptyMessage?: string;
}

export function TileRow({ id, title, items, emptyMessage }: TileRowProps): React.JSX.Element | null {
  const launch = useLibraryStore((s) => s.launch);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);

  if (items.length === 0 && !emptyMessage) return null;

  return (
    <section className="aura-row" aria-label={title}>
      <h2 className="aura-row-title">
        {title}
        {items.length > 0 ? <span className="aura-row-count">{items.length}</span> : null}
      </h2>

      {items.length === 0 ? (
        <p className="aura-row-empty">{emptyMessage}</p>
      ) : (
        <div className="aura-row-items">
          {items.map((item) => (
            <Tile
              key={item.id}
              rowId={id}
              item={item}
              onActivate={(target) => {
                setFocusedItem(target.id);
                setOverlay(null);
                void launch(target.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
