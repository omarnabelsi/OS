/**
 * The visible frame: background, nav bar, hero, the active screen and the overlay layer.
 *
 * This is also where the stores are wired to the core's event stream and where the first load
 * happens, so every screen below can assume the data is either present or explicitly loading.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

import { api } from '@/bridge';
import { Screen } from '@/screens';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';

import { Background } from './Background';
import { Hero } from './Hero';
import { NavBar } from './NavBar';
import { Overlays } from './Overlays';

export function Shell(): React.JSX.Element {
  const screen = useUiStore((s) => s.screen);
  const bindUi = useUiStore((s) => s.bindEvents);
  const bindLibrary = useLibraryStore((s) => s.bindEvents);
  const loadLibrary = useLibraryStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);
  const libraryError = useLibraryStore((s) => s.error);
  const pushToast = useUiStore((s) => s.pushToast);

  // Subscribe before the first load so an event arriving mid-flight is not missed.
  useEffect(() => {
    const offUi = bindUi();
    const offLibrary = bindLibrary();
    void loadSettings();
    void loadLibrary();
    return () => {
      offUi();
      offLibrary();
    };
  }, [bindUi, bindLibrary, loadSettings, loadLibrary]);

  // Surface library failures the same way the core surfaces its own warnings.
  useEffect(() => {
    if (libraryError) pushToast('error', libraryError);
  }, [libraryError, pushToast]);

  // Tell the host we have painted, so it can reveal the (initially hidden) native window.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void api.shellReady());
    return () => cancelAnimationFrame(frame);
  }, []);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.26, ease: [0.05, 0.7, 0.1, 1] as const };

  return (
    <div className="aura-root" data-screen={screen}>
      <Background />
      <NavBar />

      <main className="aura-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            className="aura-screen-slot"
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -10 }}
            transition={transition}
          >
            <Screen />
          </motion.div>
        </AnimatePresence>
      </main>

      {screen === 'home' ? <Hero /> : null}

      <Overlays />
    </div>
  );
}
