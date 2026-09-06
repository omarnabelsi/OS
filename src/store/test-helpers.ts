/**
 * Hand-written fake `AuraApi` + fixtures for the store tests. Tests mock '@/bridge' with
 * `{ api: fakeApi, onCoreEvent, emitLocal }` where the event functions come from the real
 * '@/bridge/events' local emitter (so `emitLocal(...)` drives the stores exactly like the mock
 * bridge does). Not a test file itself.
 */

import { vi } from 'vitest';

import type { AuraApi } from '@/bridge/api';
import type { Artwork, LaunchSession, LibraryItem, Settings, Stats } from '@/bridge/types';

export const baseSettings: Settings = {
  themeId: 'aura-default',
  wallpaper: { kind: 'theme' },
  accentColor: null,
  tileSize: 'medium',
  uiScale: 1,
  soundVolume: 0.8,
  musicVolume: 0.5,
  soundsEnabled: true,
  exitHotkey: 'Ctrl+Shift+Escape',
  steamgriddbApiKey: null,
  hideShellOnLaunch: true,
  startFullscreen: true,
  alwaysOnTop: false,
  monitorIndex: null,
  gamepadEnabled: true,
  reduceMotion: false,
  scanOnStartup: true,
  language: 'en',
};

const emptyArtwork: Artwork = { grid: null, hero: null, logo: null, icon: null, source: null, userOverride: false };
const emptyStats: Stats = { playtimeSecs: 0, launchCount: 0, lastPlayed: null, favourite: false, hidden: false };

type ItemOverrides = Partial<Omit<LibraryItem, 'stats' | 'artwork'>> & {
  stats?: Partial<Stats>;
  artwork?: Partial<Artwork>;
};

export function makeItem(id: string, name: string, overrides: ItemOverrides = {}): LibraryItem {
  const { stats, artwork, ...rest } = overrides;
  return {
    id,
    name,
    type: 'game',
    source: 'steam',
    sourceId: null,
    launch: { kind: 'exe', path: `C:/games/${id}.exe`, args: [], cwd: null },
    installPath: null,
    installSize: null,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
    artwork: { ...emptyArtwork, ...artwork },
    stats: { ...emptyStats, ...stats },
  };
}

export const sampleItems: LibraryItem[] = [
  makeItem('g-portal', 'Portal 2', { stats: { lastPlayed: 300, favourite: true } }),
  makeItem('g-celeste', 'Celeste', { stats: { lastPlayed: 500 } }),
  makeItem('g-hades', 'Hades', { stats: { lastPlayed: 100 } }),
  makeItem('g-hidden', 'Secret Game', { stats: { hidden: true, lastPlayed: 900, favourite: true } }),
  makeItem('a-vscode', 'Visual Studio Code', { type: 'app', source: 'manual', stats: { lastPlayed: 400 } }),
  makeItem('a-blender', 'Blender', { type: 'app', source: 'manual', stats: { favourite: true } }),
];

export const sampleSession: LaunchSession = { sessionId: 's-1', entryId: 'g-portal', pid: 4242, startedAt: 1000 };

type FakeApi = { [K in keyof AuraApi]: ReturnType<typeof vi.fn<AuraApi[K]>> };

export const fakeApi: FakeApi = {
  getAppInfo: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  addManualEntry: vi.fn(),
  updateEntry: vi.fn(),
  removeEntry: vi.fn(),
  scanLibrary: vi.fn(),
  fetchArtwork: vi.fn(),
  setArtworkOverride: vi.fn(),
  launchEntry: vi.fn(),
  activeSessions: vi.fn(),
  listThemes: vi.fn(),
  getTheme: vi.fn(),
  setActiveTheme: vi.fn(),
  getMonitors: vi.fn(),
  setFullscreen: vi.fn(),
  shellReady: vi.fn(),
  exitShell: vi.fn(),
  minimizeShell: vi.fn(),
  pickFile: vi.fn(),
};

/** Reset every fake to a sensible "happy path" default. */
export function resetFakeApi(): void {
  for (const fn of Object.values(fakeApi)) fn.mockReset();
  fakeApi.getSettings.mockResolvedValue({ ...baseSettings });
  fakeApi.updateSettings.mockImplementation(async (patch) => ({ ...baseSettings, ...patch }));
  fakeApi.listEntries.mockResolvedValue(sampleItems.map((it) => ({ ...it })));
  fakeApi.getEntry.mockResolvedValue(null);
  fakeApi.updateEntry.mockImplementation(async (id, patch) => {
    const it = sampleItems.find((x) => x.id === id)!;
    return {
      ...it,
      name: patch.name ?? it.name,
      stats: {
        ...it.stats,
        favourite: patch.favourite ?? it.stats.favourite,
        hidden: patch.hidden ?? it.stats.hidden,
      },
    };
  });
  fakeApi.removeEntry.mockResolvedValue(undefined);
  fakeApi.scanLibrary.mockResolvedValue('job-1');
  fakeApi.fetchArtwork.mockResolvedValue(undefined);
  fakeApi.launchEntry.mockResolvedValue(sampleSession);
  fakeApi.activeSessions.mockResolvedValue([]);
  fakeApi.setFullscreen.mockResolvedValue(undefined);
  fakeApi.shellReady.mockResolvedValue(undefined);
  fakeApi.exitShell.mockResolvedValue(undefined);
  fakeApi.minimizeShell.mockResolvedValue(undefined);
  fakeApi.pickFile.mockResolvedValue(null);
}

/** Module shape returned by the `vi.mock('@/bridge', ...)` factory. */
export async function fakeBridgeModule() {
  const events = await vi.importActual<typeof import('@/bridge/events')>('@/bridge/events');
  return {
    api: fakeApi,
    onCoreEvent: events.onCoreEvent,
    emitLocal: events.emitLocal,
    isTauri: () => false,
    isIpcError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && 'message' in e,
  };
}

/** Let pending microtasks (resolved promises) settle without advancing fake timers. */
export const flushMicrotasks = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
