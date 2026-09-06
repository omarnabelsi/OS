/**
 * In-browser implementation of `AuraApi` for `npm run dev` outside Tauri and for tests.
 *
 * STATUS: stub - owner ui-bridge-mock agent. Requirements:
 *  - ~12 sample LibraryItems (steam + manual), no artwork paths (UI must render placeholders)
 *    plus 2 with `artwork.grid` set to an inline data-URI SVG so the art path is exercised
 *  - settings in localStorage under `aura.mock.settings`
 *  - scanLibrary simulates progress with setTimeout and `emitLocal('library://scan-progress')`
 *  - launchEntry emits `process://started`, then `process://exited` after ~4s
 *  - getTheme returns the bundled `themes/aura-default` via Vite `?raw` / JSON imports so the
 *    browser build shows the real theme (sounds map to `/themes/aura-default/sounds/*.wav`
 *    served by Vite `publicDir`... or via `import.meta.glob`; the agent decides and documents)
 *  - pickFile uses a hidden <input type=file> and returns the File's name (no real path)
 */

import type { AuraApi } from './api';

function notReady(name: string): never {
  throw new Error(`mockApi.${name} not implemented yet`);
}

export const mockApi: AuraApi = {
  getAppInfo: async () => ({
    version: '0.1.0-mock',
    dataDir: '/mock/data',
    cacheDir: '/mock/cache',
    artworkDir: '/mock/cache/artwork',
    themesDir: '/themes',
    userThemesDir: '/mock/data/themes',
    mode: 'overlay',
    smoke: false,
  }),
  getSettings: async () => notReady('getSettings'),
  updateSettings: async () => notReady('updateSettings'),
  listEntries: async () => notReady('listEntries'),
  getEntry: async () => notReady('getEntry'),
  addManualEntry: async () => notReady('addManualEntry'),
  updateEntry: async () => notReady('updateEntry'),
  removeEntry: async () => notReady('removeEntry'),
  scanLibrary: async () => notReady('scanLibrary'),
  fetchArtwork: async () => notReady('fetchArtwork'),
  setArtworkOverride: async () => notReady('setArtworkOverride'),
  launchEntry: async () => notReady('launchEntry'),
  activeSessions: async () => [],
  listThemes: async () => notReady('listThemes'),
  getTheme: async () => notReady('getTheme'),
  setActiveTheme: async () => notReady('setActiveTheme'),
  getMonitors: async () => [
    { name: 'Mock', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: true },
  ],
  setFullscreen: async () => {},
  shellReady: async () => {},
  exitShell: async () => {},
  minimizeShell: async () => {},
  pickFile: async () => null,
};
