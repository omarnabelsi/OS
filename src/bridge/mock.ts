/**
 * In-browser implementation of `AuraApi` for `npm run dev` outside Tauri and for tests.
 *
 * It is a real fake, not a set of stubs: it holds a mutable library, persists settings to
 * localStorage, and drives the same `library://*` and `process://*` events the core emits, so
 * every screen can be developed and demoed without Windows, Rust or a Steam install.
 *
 * The theme comes from the actual `themes/aura-default` package, imported through Vite, so what
 * the browser shows is the same tokens, CSS and shaders the packaged app loads from disk.
 */

import themeManifest from '../../themes/aura-default/manifest.json';
import themeTokens from '../../themes/aura-default/tokens.json';
import themeLayout from '../../themes/aura-default/layout.json';
import themeCss from '../../themes/aura-default/theme.css?raw';
import auroraShader from '../../themes/aura-default/shaders/aurora.frag?raw';
import nebulaShader from '../../themes/aura-default/shaders/nebula.frag?raw';
import moveSound from '../../themes/aura-default/sounds/move.wav?url';
import selectSound from '../../themes/aura-default/sounds/select.wav?url';
import backSound from '../../themes/aura-default/sounds/back.wav?url';
import launchSound from '../../themes/aura-default/sounds/launch.wav?url';
import errorSound from '../../themes/aura-default/sounds/error.wav?url';

import type { AuraApi } from './api';
import { emitLocal } from './events';
import type {
  Artwork,
  EntryFilter,
  LaunchSession,
  LibraryItem,
  Settings,
  Stats,
  ThemeBundle,
  ThemeInfo,
  ThemeLayout,
  ThemeTokens,
} from './types';

const SETTINGS_KEY = 'aura.mock.settings';

// ---- sample artwork ------------------------------------------------------------------------------

/**
 * A generated cover, inlined as a data URI. Two entries use these so the artwork path is
 * exercised in the browser; everything else deliberately has no art so the placeholder tile is
 * exercised too.
 */
function coverDataUri(title: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#g)"/>
  <circle cx="300" cy="330" r="160" fill="rgba(255,255,255,0.10)"/>
  <text x="300" y="770" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif"
        font-size="54" font-weight="700" fill="rgba(255,255,255,0.92)">${title}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const noArtwork = (): Artwork => ({
  grid: null,
  hero: null,
  logo: null,
  icon: null,
  source: null,
  userOverride: false,
});

const noStats = (): Stats => ({
  playtimeSecs: 0,
  launchCount: 0,
  lastPlayed: null,
  favourite: false,
  hidden: false,
});

// ---- sample library -------------------------------------------------------------------------------

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);

interface Seed {
  id: string;
  name: string;
  type: LibraryItem['type'];
  source: LibraryItem['source'];
  appid?: string;
  playedHoursAgo?: number;
  playtimeHours?: number;
  favourite?: boolean;
  hidden?: boolean;
  cover?: [string, string];
}

const SEEDS: Seed[] = [
  { id: 'g-solstice', name: 'Solstice Drift', type: 'game', source: 'steam', appid: '901001', playedHoursAgo: 2, playtimeHours: 41, favourite: true, cover: ['#1b3a6b', '#0a1226'] },
  { id: 'g-hollowlight', name: 'Hollowlight', type: 'game', source: 'steam', appid: '901002', playedHoursAgo: 9, playtimeHours: 17, cover: ['#5c2b6b', '#150a26'] },
  { id: 'g-ironhold', name: 'Ironhold Tactics', type: 'game', source: 'steam', appid: '901003', playedHoursAgo: 30, playtimeHours: 63, favourite: true },
  { id: 'g-nightmarket', name: 'Night Market', type: 'game', source: 'steam', appid: '901004', playedHoursAgo: 74, playtimeHours: 8 },
  { id: 'g-pale', name: 'Pale Horizon', type: 'game', source: 'steam', appid: '901005', playtimeHours: 2 },
  { id: 'g-driftwood', name: 'Driftwood Bay', type: 'game', source: 'steam', appid: '901006', playedHoursAgo: 120, playtimeHours: 22 },
  { id: 'g-kilowatt', name: 'Kilowatt', type: 'game', source: 'steam', appid: '901007' },
  { id: 'g-verdant', name: 'Verdant', type: 'game', source: 'steam', appid: '901008', playedHoursAgo: 300, playtimeHours: 5 },
  { id: 'g-lastsignal', name: 'The Last Signal', type: 'game', source: 'manual' },
  { id: 'g-shelved', name: 'Shelved Prototype', type: 'game', source: 'manual', hidden: true },
  { id: 'a-atlas', name: 'Atlas Editor', type: 'app', source: 'manual', playedHoursAgo: 5, playtimeHours: 90, favourite: true },
  { id: 'a-waveform', name: 'Waveform', type: 'app', source: 'manual', playedHoursAgo: 48, playtimeHours: 12 },
  { id: 'a-ledger', name: 'Ledger', type: 'app', source: 'manual' },
];

function seedToItem(seed: Seed): LibraryItem {
  const artwork = noArtwork();
  if (seed.cover) {
    artwork.grid = coverDataUri(seed.name, seed.cover[0], seed.cover[1]);
    artwork.source = 'mock';
  }
  return {
    id: seed.id,
    name: seed.name,
    type: seed.type,
    source: seed.source,
    sourceId: seed.appid ?? null,
    launch: seed.appid
      ? { kind: 'uri', uri: `steam://rungameid/${seed.appid}` }
      : { kind: 'exe', path: `C:/Programs/${seed.name}/${seed.id}.exe`, args: [], cwd: null },
    installPath: `C:/Programs/${seed.name}`,
    installSize: 1024 * 1024 * (400 + SEEDS.indexOf(seed) * 137),
    createdAt: now - 86400 * (SEEDS.indexOf(seed) + 1),
    updatedAt: now,
    artwork,
    stats: {
      ...noStats(),
      lastPlayed: seed.playedHoursAgo === undefined ? null : now - seed.playedHoursAgo * HOUR,
      playtimeSecs: (seed.playtimeHours ?? 0) * HOUR,
      launchCount: seed.playedHoursAgo === undefined ? 0 : 3,
      favourite: seed.favourite ?? false,
      hidden: seed.hidden ?? false,
    },
  };
}

let library: LibraryItem[] = SEEDS.map(seedToItem);

// ---- settings ---------------------------------------------------------------------------------

const defaultSettings: Settings = {
  themeId: 'aura-default',
  wallpaper: { kind: 'theme' },
  accentColor: null,
  tileSize: 'medium',
  uiScale: 1,
  soundVolume: 0.6,
  musicVolume: 0.3,
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

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // A private window or blocked storage is fine - fall back to defaults.
  }
  return { ...defaultSettings };
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore: the mock is a development convenience, not a system of record.
  }
}

let settings = loadSettings();

// ---- theme ------------------------------------------------------------------------------------

const themeInfo: ThemeInfo = {
  id: themeManifest.id,
  name: themeManifest.name,
  author: themeManifest.author,
  version: themeManifest.version,
  description: themeManifest.description,
  screenshots: [],
  path: '/themes/aura-default',
  builtin: true,
  minAppVersion: themeManifest.minAppVersion ?? null,
};

const themeBundle: ThemeBundle = {
  info: themeInfo,
  // JSON imports widen string literals ("top" -> string), so the shapes are asserted rather
  // than inferred. The theme files themselves are the contract; validate-theme.mjs checks them.
  tokens: themeTokens as ThemeTokens,
  layout: themeLayout as unknown as ThemeLayout,
  css: themeCss,
  sounds: {
    move: moveSound,
    select: selectSound,
    back: backSound,
    launch: launchSound,
    error: errorSound,
  },
  shaders: { aurora: auroraShader, nebula: nebulaShader },
  assetsDir: '/themes/aura-default/assets',
};

// ---- filtering ----------------------------------------------------------------------------------

function applyFilter(items: LibraryItem[], filter?: EntryFilter): LibraryItem[] {
  let out = items.slice();
  if (!filter?.includeHidden) out = out.filter((i) => !i.stats.hidden);
  if (filter?.type) out = out.filter((i) => i.type === filter.type);
  if (filter?.source) out = out.filter((i) => i.source === filter.source);
  if (filter?.favouritesOnly) out = out.filter((i) => i.stats.favourite);
  if (filter?.search) {
    const term = filter.search.toLowerCase();
    out = out.filter((i) => i.name.toLowerCase().includes(term));
  }

  switch (filter?.sort ?? 'name') {
    case 'last_played':
      out.sort((a, b) => (b.stats.lastPlayed ?? 0) - (a.stats.lastPlayed ?? 0));
      break;
    case 'playtime':
      out.sort((a, b) => b.stats.playtimeSecs - a.stats.playtimeSecs);
      break;
    case 'recently_added':
      out.sort((a, b) => b.createdAt - a.createdAt);
      break;
    default:
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  if (filter?.limit != null) out = out.slice(0, filter.limit);
  return out;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---- timers -----------------------------------------------------------------------------------

/** Every timer the mock starts, so tests can stop them deterministically. */
const timers = new Set<ReturnType<typeof setTimeout>>();

function later(ms: number, fn: () => void): void {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
}

/** Cancel every pending mock timer. Exported for tests. */
export function resetMock(): void {
  for (const id of timers) clearTimeout(id);
  timers.clear();
  library = SEEDS.map(seedToItem);
  settings = { ...defaultSettings };
}

// ---- api ---------------------------------------------------------------------------------------

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

  getSettings: async () => clone(settings),

  updateSettings: async (patch) => {
    for (const key of Object.keys(patch)) {
      if (!(key in defaultSettings)) throw { code: 'invalid', message: `unknown setting \`${key}\`` };
    }
    settings = { ...settings, ...patch };
    if (settings.uiScale < 0.5 || settings.uiScale > 2) {
      settings = { ...settings, uiScale: Math.min(2, Math.max(0.5, settings.uiScale)) };
    }
    saveSettings(settings);
    return clone(settings);
  },

  listEntries: async (filter) => clone(applyFilter(library, filter)),

  getEntry: async (id) => clone(library.find((i) => i.id === id) ?? null),

  addManualEntry: async (input) => {
    const name = input.name?.trim() || input.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'New item';
    const item: LibraryItem = {
      id: `m-${Date.now().toString(36)}`,
      name,
      type: input.type ?? 'app',
      source: 'manual',
      sourceId: null,
      launch: { kind: 'exe', path: input.path, args: input.args ?? [], cwd: null },
      installPath: null,
      installSize: null,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      artwork: noArtwork(),
      stats: noStats(),
    };
    library = [...library, item];
    emitLocal('library://updated', { entryIds: [item.id], reason: 'manual_add' });
    return clone(item);
  },

  updateEntry: async (id, patch) => {
    const item = library.find((i) => i.id === id);
    if (!item) throw { code: 'not_found', message: `entry \`${id}\`` };
    const next: LibraryItem = {
      ...item,
      name: patch.name ?? item.name,
      launch: patch.launch ?? item.launch,
      stats: {
        ...item.stats,
        favourite: patch.favourite ?? item.stats.favourite,
        hidden: patch.hidden ?? item.stats.hidden,
      },
    };
    library = library.map((i) => (i.id === id ? next : i));
    emitLocal('library://updated', { entryIds: [id], reason: 'update' });
    return clone(next);
  },

  removeEntry: async (id) => {
    library = library.filter((i) => i.id !== id);
    emitLocal('library://updated', { entryIds: [id], reason: 'remove' });
  },

  scanLibrary: async (sources) => {
    const jobId = `mock-scan-${Date.now().toString(36)}`;
    const source = sources?.[0] ?? 'steam';
    const found = library.filter((i) => i.source === 'steam').length;

    emitLocal('library://scan-progress', { jobId, source: null, stage: 'queued', found: 0, message: null, done: false });
    later(180, () =>
      emitLocal('library://scan-progress', { jobId, source, stage: 'discovering', found: 0, message: 'Looking for Steam libraries', done: false }),
    );
    later(520, () =>
      emitLocal('library://scan-progress', { jobId, source, stage: 'parsing', found, message: null, done: false }),
    );
    later(820, () =>
      emitLocal('library://scan-progress', { jobId, source, stage: 'saving', found, message: null, done: false }),
    );
    later(1100, () => {
      emitLocal('library://updated', { entryIds: library.map((i) => i.id), reason: 'scan' });
      emitLocal('library://scan-progress', { jobId, source: null, stage: 'done', found, message: null, done: true });
    });
    return jobId;
  },

  fetchArtwork: async (entryId) => {
    const item = library.find((i) => i.id === entryId);
    if (!item) return;
    // Produce a cover so "Find artwork" visibly does something in the browser.
    later(700, () => {
      const path = coverDataUri(item.name, '#20405c', '#0a1220');
      library = library.map((i) =>
        i.id === entryId ? { ...i, artwork: { ...i.artwork, grid: path, source: 'mock' } } : i,
      );
      emitLocal('library://artwork', { entryId, kind: 'grid', path, source: 'mock' });
    });
  },

  setArtworkOverride: async (entryId, kind, path) => {
    const item = library.find((i) => i.id === entryId);
    if (!item) throw { code: 'not_found', message: `entry \`${entryId}\`` };
    const artwork: Artwork = { ...item.artwork, [kind]: path, source: 'user', userOverride: true };
    library = library.map((i) => (i.id === entryId ? { ...i, artwork } : i));
    emitLocal('library://artwork', { entryId, kind, path, source: 'user' });
    return clone(artwork);
  },

  launchEntry: async (id) => {
    const item = library.find((i) => i.id === id);
    if (!item) throw { code: 'not_found', message: `entry \`${id}\`` };

    const session: LaunchSession = {
      sessionId: `mock-session-${Date.now().toString(36)}`,
      entryId: id,
      pid: 4242,
      startedAt: Math.floor(Date.now() / 1000),
    };
    activeSessions.push(session);
    emitLocal('process://started', session);

    later(4000, () => {
      const i = activeSessions.findIndex((s) => s.sessionId === session.sessionId);
      if (i >= 0) activeSessions.splice(i, 1);
      library = library.map((it) =>
        it.id === id
          ? {
              ...it,
              stats: {
                ...it.stats,
                lastPlayed: Math.floor(Date.now() / 1000),
                launchCount: it.stats.launchCount + 1,
                playtimeSecs: it.stats.playtimeSecs + 4,
              },
            }
          : it,
      );
      emitLocal('process://exited', { sessionId: session.sessionId, entryId: id, exitCode: 0, durationSecs: 4 });
    });

    return clone(session);
  },

  activeSessions: async () => clone(activeSessions),

  listThemes: async () => [clone(themeInfo)],
  getTheme: async () => clone(themeBundle),
  setActiveTheme: async (id) => {
    settings = { ...settings, themeId: id };
    saveSettings(settings);
    emitLocal('theme://changed', { themeId: id });
    return clone(themeBundle);
  },

  getMonitors: async () => [
    { name: 'Mock Display', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: true },
  ],

  setFullscreen: async () => {},
  shellReady: async () => {},
  exitShell: async () => {
    emitLocal('shell://toast', { level: 'info', message: 'Exit is only available in the app' });
  },
  minimizeShell: async () => {},

  /**
   * A browser cannot read a real path, so this returns the file's name. Enough to exercise the
   * add-item and artwork-override flows in dev.
   */
  pickFile: (kind) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      const accept = {
        exe: '.exe,.lnk,.url,.bat,.cmd',
        image: 'image/*',
        video: 'video/*',
        any: '',
      }[kind];
      if (accept) input.accept = accept;

      const finish = (value: string | null) => {
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return finish(null);
        // Images become object URLs so the artwork override actually displays.
        finish(kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : file.name);
      });
      input.addEventListener('cancel', () => finish(null));
      document.body.appendChild(input);
      input.click();
    }),
};

const activeSessions: LaunchSession[] = [];
