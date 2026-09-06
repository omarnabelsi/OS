/**
 * The hero panel: large art, title and metadata for whatever currently has focus.
 *
 * It reads the focused item rather than a selection, so moving the D-pad (or the mouse) updates
 * it immediately. The art cross-fades and drifts a little as focus changes - the parallax the
 * plan asks for, done with transform and opacity only so it stays on the compositor.
 */

import { AnimatePresence, motion } from 'framer-motion';

import type { LibraryItem } from '@/bridge';
import { assetUrl } from '@/lib/assetUrl';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';

import { Icon } from './Icon';

export function formatPlaytime(seconds: number): string | null {
  if (seconds <= 0) return null;
  const hours = seconds / 3600;
  if (hours >= 1) return `${Math.round(hours)} h played`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min played`;
}

export function formatLastPlayed(unixSeconds: number | null, now = Date.now()): string | null {
  if (!unixSeconds) return null;
  const elapsed = Math.max(0, now / 1000 - unixSeconds);

  if (elapsed < 3600) return 'Played just now';
  if (elapsed < 86400) {
    const hours = Math.round(elapsed / 3600);
    return `Played ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(elapsed / 86400);
  if (days < 30) return `Played ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `Played ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `Played ${years} year${years === 1 ? '' : 's'} ago`;
}

export function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const SOURCE_LABELS: Record<LibraryItem['source'], string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  ea: 'EA',
  uwp: 'Microsoft Store',
  manual: 'Added manually',
};

export function Hero(): React.JSX.Element {
  const focusedId = useUiStore((s) => s.focusedItemId);
  const item = useLibraryStore((s) => (focusedId ? s.byId[focusedId] : undefined));
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);

  const art = item ? assetUrl(item.artwork.hero ?? item.artwork.grid ?? undefined) : undefined;

  const facts = item
    ? [
        SOURCE_LABELS[item.source],
        formatLastPlayed(item.stats.lastPlayed),
        formatPlaytime(item.stats.playtimeSecs),
        formatSize(item.installSize),
      ].filter((f): f is string => Boolean(f))
    : [];

  const motionProps = reduceMotion
    ? { initial: false, animate: { opacity: 1, x: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -16 },
        transition: { duration: 0.32, ease: [0.05, 0.7, 0.1, 1] as const },
      };

  return (
    <div className="aura-hero">
      <AnimatePresence mode="wait">
        {item ? (
          <motion.div key={item.id} className="aura-hero-body" {...motionProps}>
            <h1 className="aura-hero-title">{item.name}</h1>
            {facts.length > 0 ? (
              <p className="aura-hero-facts">
                {facts.map((fact, i) => (
                  <span key={fact}>
                    {i > 0 ? <span className="aura-hero-sep">·</span> : null}
                    {fact}
                  </span>
                ))}
              </p>
            ) : null}
            <p className="aura-hero-hint">
              <Icon name="play" size="0.9em" /> Press <kbd>Enter</kbd> or <kbd>A</kbd> to play
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {art ? (
          <motion.img
            key={art}
            className="aura-hero-art"
            src={art}
            alt=""
            initial={reduceMotion ? false : { opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: 'easeOut' }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
