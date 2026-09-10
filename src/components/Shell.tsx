/**
 * The visible frame: background, nav bar, the active screen, the window layer, the taskbar and
 * the overlay layer.
 *
 * This is also where the stores are wired to the core's event stream and where the first load
 * happens, so every screen below can assume the data is either present or explicitly loading.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

import { api } from '@/bridge';
import { Screen } from '@/screens';
import { useDesktopStore, useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useWmStore, WindowLayer, type WindowBodyRenderer, type WindowInstance } from '@/wm';

import { Background } from './Background';
import { FolderEditor } from './desktop/FolderEditor';
import { FolderWindowBody } from './desktop/FolderWindowBody';
import { NavBar } from './NavBar';
import { Overlays } from './Overlays';
import { SettingsApp } from './settings/SettingsApp';
import { Taskbar } from './taskbar/Taskbar';

/**
 * What renders inside each kind of window.
 *
 * Module scope so the object identity is stable - `WindowLayer` takes it as a prop. The window
 * manager knows nothing about folders, the folder editor or Settings; a new kind of window is
 * a new entry here plus a `WindowKind`, and nothing in `src/wm` changes.
 */
const WINDOW_BODIES: Partial<Record<WindowInstance['kind'], WindowBodyRenderer>> = {
  folder: (window) => <FolderWindowBody window={window} />,
  folderEditor: (window) => <FolderEditor window={window} />,
  settings: (window) => <SettingsApp group={`window:${window.id}`} variant="panes" />,
};

export function Shell(): React.JSX.Element {
  const screen = useUiStore((s) => s.screen);
  const bindUi = useUiStore((s) => s.bindEvents);
  const bindLibrary = useLibraryStore((s) => s.bindEvents);
  const bindDesktop = useDesktopStore((s) => s.bindEvents);
  const loadLibrary = useLibraryStore((s) => s.load);
  const loadDesktop = useDesktopStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);
  const taskbarPosition = useSettingsStore((s) => s.settings?.taskbarPosition ?? 'bottom');
  const libraryError = useLibraryStore((s) => s.error);
  const pushToast = useUiStore((s) => s.pushToast);

  // Subscribe before the first load so an event arriving mid-flight is not missed.
  useEffect(() => {
    const offUi = bindUi();
    const offLibrary = bindLibrary();
    const offDesktop = bindDesktop();
    void loadSettings();
    void loadLibrary();
    void loadDesktop();
    return () => {
      offUi();
      offLibrary();
      offDesktop();
    };
  }, [bindUi, bindLibrary, bindDesktop, loadSettings, loadLibrary, loadDesktop]);

  // Surface library failures the same way the core surfaces its own warnings.
  useEffect(() => {
    if (libraryError) pushToast('error', libraryError);
  }, [libraryError, pushToast]);

  /*
   * Say so when the escape hatch is not armed.
   *
   * The host logs a failed registration and carries on, which left Settings advertising a key
   * combination that did nothing - the worst outcome for the one documented way out of a
   * fullscreen shell. This toast has no TTL: it stays until dismissed.
   */
  useEffect(() => {
    void (async () => {
      try {
        const status = await api.getExitHotkeyStatus();
        if (status.registered) return;
        pushToast(
          'error',
          `Exit hotkey ${status.accelerator} is not active${status.error ? ` - ${status.error}` : ''}. ` +
            'Pick another one in Settings.',
          0,
        );
      } catch {
        // An older host without the command is not worth a message to the user.
      }
    })();
  }, [pushToast]);

  /*
   * Windows live on the desktop, so leaving it gives focus back to the screen.
   *
   * The focused window claims the focus scope (docs/RISKS.md R11). Kept while the Games screen
   * is showing, that scope would confine the D-pad to a window that is not on screen, and the
   * screen the user just opened would be unreachable. The windows themselves are untouched and
   * are all still there on the way back.
   */
  useEffect(() => {
    if (screen !== 'home') useWmStore.getState().blurAll();
  }, [screen]);

  // Tell the host we have painted, so it can reveal the (initially hidden) native window.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void api.shellReady());
    return () => cancelAnimationFrame(frame);
  }, []);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.26, ease: [0.05, 0.7, 0.1, 1] as const };

  return (
    /*
     * `data-taskbar` is what turns the frame from a column into a row: the taskbar is the last
     * child, and the CSS flips the flex direction so it lands on whichever edge is chosen
     * without the DOM order changing. Reading order and tab order then match the visual order
     * in all four configurations.
     */
    <div className="aura-root" data-screen={screen} data-taskbar={taskbarPosition}>
      <Background />

      <div className="aura-frame">
        <NavBar />

        <main className="aura-main" data-surface={screen === 'home' || undefined}>
          {/*
           * No hero any more. It belonged to the launcher framing - one big "currently selected
           * game" panel above a stack of rows. Home is a desktop now, so the surface fills the
           * space and each item speaks for itself.
           */}
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

          {/*
           * Windows live inside `.aura-main` so the layer measures exactly the area they may
           * occupy - below the nav bar, beside the taskbar, above the overlay layer.
           * Constraining and snapping both divide up that measured rectangle, not the screen,
           * so moving the taskbar to another edge moves what a window can cover with it.
           *
           * Mounted only on the desktop. The other screens are scrolling lists, and a window
           * inside a scroller scrolls away with the content; the window *state* lives in the
           * store and is all still there when Home comes back.
           */}
          {screen === 'home' ? <WindowLayer renderers={WINDOW_BODIES} /> : null}
        </main>
      </div>

      <Taskbar />
      <Overlays />
    </div>
  );
}
