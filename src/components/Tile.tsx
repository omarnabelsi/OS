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
import { useTheme } from '@/theme';

import { Icon } from './Icon';

/** Stable pleasant colour from a name, for tiles that have no artwork yet. */
export function placeholderHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export interface TileProps {
  item: LibraryItem;
  /** Distinguishes the same item appearing in two rows, or in two windows. */
  rowId: string;
  /**
   * Focus group. Defaults to the screen's content, but a tile inside a window belongs to that
   * window's group (`window:<id>`) so directional navigation cannot wander between overlapping
   * windows - see docs/RISKS.md R11.
   */
  group?: string;
  onActivate(item: LibraryItem): void;
}

export function Tile({ item, rowId, group = 'content', onActivate }: TileProps): React.JSX.Element {
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);
  // From `tile.focusScale`, not a literal - the CSS reserving room for the scaled tile reads the
  // same token, and the two must not drift.
  const { focusScale } = useTheme();

  const {
    ref,
    visible: focused,
    props: focusProps,
  } = useFocusable({
    id: `tile:${rowId}:${item.id}`,
    group,
    onActivate: () => onActivate(item),
    onFocus: () => setFocusedItem(item.id),
  });
  /*
   * The lift, ring, bloom and revealed label are for focus the user placed with the D-pad or the
   * keyboard. A pointer resting on a tile gets the hover state instead - otherwise hover *was*
   * focus and the design's separate 1.03 hover could never be seen. `onFocus` still fires either
   * way, so the hero panel and the colour bleed follow the pointer as they always did.
   */
  const props = { ...focusProps, 'data-focused': focused || undefined };

  const art = assetUrl(item.artwork.grid ?? item.artwork.hero ?? undefined);
  const hue = useMemo(() => placeholderHue(item.name), [item.name]);

  return (
    /*
     * The scale lives on the wrapper, not the button.
     *
     * It used to be on the button, with the label as a following sibling. At 220px wide and a 2:3
     * aspect the artwork is 330px tall, so scale(1.08) about its centre pushed it ~13px past its
     * own layout box - plus another ~5px of focus ring - onto a label that starts only ~8px
     * below. Since the label is invisible until focused, it was covered in the one state it is
     * ever seen in. Scaling the wrapper moves artwork and caption together, so the caption can
     * never be occluded by the artwork above it, at any tile size or focus scale.
     *
     * The room this needs outside the wrapper is reserved by `--tile-focus-bleed` in shell.css,
     * derived from the same `focusScale` token used here.
     */
    <motion.div
      className="aura-tile-wrap"
      data-focused={focused || undefined}
      animate={{ scale: focused && !reduceMotion ? focusScale : 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
      // Stated rather than inherited, so the growth direction is a decision: the tile expands
      // evenly about its centre and the row's baseline does not shift.
      style={{ transformOrigin: 'center center' }}
    >
      {/* The label sits outside the button so the theme's focus ring hugs the artwork rather
          than enclosing a caption that is only visible while focused. */}
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className="aura-tile"
        title={item.name}
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
      </button>

      <span className="aura-tile-label aura-type-tile-label">{item.name}</span>
    </motion.div>
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
      <h2 className="aura-row-title aura-type-section">
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
