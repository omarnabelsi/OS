/**
 * Theme sounds - short interface blips, fired one per interaction. This is the whole of the app's
 * audio: there is no music, soundtrack or ambience anywhere, and nothing here loops.
 *
 * `useSound()` returns a `play(name)` that is safe to call from anywhere, on every
 * focus change, without the caller thinking about volume, muting or preloading.
 *
 * Each slot keeps one decoded <audio> element and plays a lightweight clone, so a fast run along
 * a tile row overlaps naturally instead of cutting itself off. Failures are swallowed on purpose:
 * a missing sound file must never break navigation, and browsers reject playback until the user
 * has interacted with the page at least once.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { assetUrl } from '@/lib/assetUrl';
import { useSettingsStore } from '@/store';
import { useTheme } from '@/theme';

export type SoundName = 'move' | 'select' | 'back' | 'launch' | 'error';

/**
 * The same five slots at runtime, so the preload below can reject anything else.
 *
 * These short interface sounds are the only audio the app plays: there is no music, soundtrack or
 * ambience slot, and nothing here loops or plays unprompted. `theme::loader` already drops unknown
 * slots; this is the UI half of that rule, so it holds whatever a bridge hands over.
 */
const SOUND_NAMES: readonly SoundName[] = ['move', 'select', 'back', 'launch', 'error'];

export type PlaySound = (name: SoundName) => void;

const SoundContext = createContext<PlaySound>(() => {});

export function SoundProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { bundle } = useTheme();
  const settings = useSettingsStore((s) => s.settings);

  const enabled = settings?.soundsEnabled ?? true;
  const volume = settings?.soundVolume ?? 0.6;

  const elements = useRef(new Map<SoundName, HTMLAudioElement>());

  // Preload whatever the theme provides. Slots the theme omits simply stay silent.
  useEffect(() => {
    const map = elements.current;
    map.clear();
    if (!bundle) return;

    for (const [name, path] of Object.entries(bundle.sounds)) {
      // An unrecognised slot is never played, so it must not be fetched either.
      if (!(SOUND_NAMES as readonly string[]).includes(name)) continue;
      const url = assetUrl(path);
      if (!url) continue;
      const audio = new Audio(url);
      audio.preload = 'auto';
      map.set(name as SoundName, audio);
    }

    return () => map.clear();
  }, [bundle]);

  // Read settings through a ref: `play` must stay referentially stable or every consumer
  // re-subscribes on each volume tick of a dragged slider.
  const config = useRef({ enabled, volume });
  config.current = { enabled, volume };

  const play = useMemo<PlaySound>(
    () => (name) => {
      const { enabled: on, volume: level } = config.current;
      if (!on || level <= 0) return;

      const source = elements.current.get(name);
      if (!source) return;

      try {
        const voice = source.cloneNode(true) as HTMLAudioElement;
        voice.volume = Math.min(1, Math.max(0, level));
        // Autoplay is blocked until the first user gesture; that rejection is expected.
        void voice.play().catch(() => {});
      } catch {
        // jsdom and locked-down webviews have no working audio - navigation still works.
      }
    },
    [],
  );

  return <SoundContext.Provider value={play}>{children}</SoundContext.Provider>;
}

export function useSound(): PlaySound {
  return useContext(SoundContext);
}
