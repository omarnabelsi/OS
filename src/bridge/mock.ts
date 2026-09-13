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
// The second bundled theme, imported the same way, so theme switching can be exercised in a
// browser against the real package rather than a stand-in.
import paperManifest from '../../themes/aura-paper/manifest.json';
import paperTokens from '../../themes/aura-paper/tokens.json';
import paperLayout from '../../themes/aura-paper/layout.json';
import paperCss from '../../themes/aura-paper/theme.css?raw';
import paperMoveSound from '../../themes/aura-paper/sounds/move.wav?url';
import paperSelectSound from '../../themes/aura-paper/sounds/select.wav?url';
import paperBackSound from '../../themes/aura-paper/sounds/back.wav?url';
import paperLaunchSound from '../../themes/aura-paper/sounds/launch.wav?url';
import paperErrorSound from '../../themes/aura-paper/sounds/error.wav?url';

import type { AuraApi } from './api';
import { emitLocal } from './events';
import type {
  Artwork,
  Desktop,
  DesktopItem,
  EntryFilter,
  Folder,
  LaunchSession,
  LibraryItem,
  Settings,
  Stats,
  TaskbarItem,
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

// ---- desktop ------------------------------------------------------------------------------------

/**
 * A seeded desktop matching what the real core creates on a first run: the old home rows as
 * smart folders, laid down the first column. Keeping this faithful is what lets the desktop
 * surface, window manager and taskbar be built entirely in the browser.
 */
const SEEDED_FOLDERS: Folder[] = [
  ['smart:games', 'Games', 'games', { type: 'game' as const }],
  ['smart:apps', 'Apps', 'apps', { type: 'app' as const }],
  ['smart:favourites', 'Favourites', 'star', { favouritesOnly: true }],
  ['smart:recently-played', 'Recently played', 'play', { sort: 'last_played' as const, limit: 24 }],
].map(([path, label, icon, filter], i) => ({
  id: `folder-${i + 1}`,
  path: path as string,
  label: label as string,
  color: null,
  icon: icon as string,
  cover: null,
  layout: 'grid' as const,
  // Mirrors the core's seeder: three different shapes, so none of the theme's looks like a dead
  // setting on a first run. See `seed_if_empty` in crates/aura-core/src/desktop/mod.rs.
  shape: (['rounded', 'capsule', 'tab', 'rounded'][i] ?? 'rounded') as string,
  kind: 'smart' as const,
  collectionId: null,
  filter: filter as EntryFilter,
  windowState: null,
  sortOrder: i,
}));

function freshDesktopState() {
  const desktops: Desktop[] = [
    {
      id: 'desktop-1',
      name: 'Desktop',
      wallpaper: null,
      grid: { cell: 96, gap: 16, snap: true, autoArrange: false },
      sortOrder: 0,
    },
  ];
  const items: DesktopItem[] = SEEDED_FOLDERS.map((f, i) => ({
    id: `item-${i + 1}`,
    desktopId: 'desktop-1',
    kind: 'folder' as const,
    targetId: f.id,
    x: 0,
    y: i,
    width: 1,
    height: 1,
    labelOverride: null,
    iconOverride: null,
    sortOrder: i,
  }));

  // The widgets, holding the right of the seven-column grid - as the core's seeder places them.
  items.push(
    ...(['clock', 'now-playing'] as const).map((widget, i) => ({
      id: `widget-${widget}`,
      desktopId: 'desktop-1',
      kind: 'widget' as const,
      targetId: widget,
      x: 5,
      y: i,
      width: 2,
      height: 1,
      labelOverride: null,
      iconOverride: null,
      sortOrder: 100 + i,
    })),
  );
  const taskbar: TaskbarItem[] = [
    { id: 'launcher', kind: 'launcher', targetId: null, sortOrder: -1000 },
    { id: 'pin-1', kind: 'pinned', targetId: 'g-solstice', sortOrder: 0 },
    { id: 'pin-2', kind: 'pinned', targetId: 'a-atlas', sortOrder: 1 },
    { id: 'system-area', kind: 'system_area', targetId: null, sortOrder: 1000 },
  ];
  return { desktops, items, folders: SEEDED_FOLDERS.map((f) => ({ ...f })), taskbar };
}

let desktopState = freshDesktopState();
let mockIdSeq = 0;
/**
 * The `n` matters: the seeded rows are `item-1`, `desktop-1` and so on, so a bare counter would
 * hand out an id that already exists and a delete-by-id would take both rows with it.
 */
const nextId = (prefix: string) => `${prefix}-n${(++mockIdSeq).toString(36)}`;

// ---- settings ---------------------------------------------------------------------------------

const defaultSettings: Settings = {
  themeId: 'aura-default',
  wallpaper: { kind: 'theme' },
  accentColor: null,
  tileSize: 'medium',
  uiScale: 1,
  soundVolume: 0.6,
  soundsEnabled: true,
  // Matches DEFAULT_EXIT_HOTKEY in crates/aura-core/src/config/settings.rs. Not
  // Ctrl+Shift+Escape: Windows reserves that for Task Manager and never hands it to an app.
  exitHotkey: 'Ctrl+Alt+Q',
  steamgriddbApiKey: null,
  hideShellOnLaunch: true,
  startFullscreen: true,
  alwaysOnTop: false,
  monitorIndex: null,
  gamepadEnabled: true,
  reduceMotion: false,
  blurMode: 'auto',
  scanOnStartup: true,
  language: 'en',
  taskbarVisible: true,
  taskbarPosition: 'bottom',
  taskbarAlignment: 'center',
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

/** A browser tab cannot really be maximised; this flag is what the mock's title bar reads. */
let mockMaximized = false;

function mockWindowState() {
  return {
    fullscreen: typeof document !== 'undefined' && Boolean(document.fullscreenElement),
    maximized: mockMaximized,
    minimized: false,
  };
}

// ---- theme ------------------------------------------------------------------------------------

interface ManifestFields {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  minAppVersion?: string;
}

/**
 * A bundle from a theme package's parts, shaped exactly as the core's loader returns one.
 *
 * JSON imports widen string literals ("top" -> string), so the shapes are asserted rather than
 * inferred. The theme files themselves are the contract; validate-theme.mjs checks them.
 */
function bundleFor(
  manifest: ManifestFields,
  tokens: unknown,
  layout: unknown,
  css: string,
  sounds: Record<string, string>,
  shaders: Record<string, string>,
): ThemeBundle {
  const path = `/themes/${manifest.id}`;
  const info: ThemeInfo = {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
    description: manifest.description,
    screenshots: [],
    path,
    builtin: true,
    minAppVersion: manifest.minAppVersion ?? null,
  };
  return {
    info,
    tokens: tokens as ThemeTokens,
    layout: layout as unknown as ThemeLayout,
    css,
    sounds,
    shaders,
    assetsDir: `${path}/assets`,
  };
}

/** Every bundled theme, keyed by id - both real packages from `themes/`. */
const THEMES: Record<string, ThemeBundle> = {
  [themeManifest.id]: bundleFor(
    themeManifest,
    themeTokens,
    themeLayout,
    themeCss,
    { move: moveSound, select: selectSound, back: backSound, launch: launchSound, error: errorSound },
    { aurora: auroraShader, nebula: nebulaShader },
  ),
  [paperManifest.id]: bundleFor(
    paperManifest,
    paperTokens,
    paperLayout,
    paperCss,
    {
      move: paperMoveSound,
      select: paperSelectSound,
      back: paperBackSound,
      launch: paperLaunchSound,
      error: paperErrorSound,
    },
    {},
  ),
};

/** The named theme, else the active one, else the default - never undefined. */
function themeBundleFor(id?: string): ThemeBundle {
  return THEMES[id ?? settings.themeId] ?? THEMES[themeManifest.id]!;
}

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
  desktopState = freshDesktopState();
  mockIdSeq = 0;
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

  // ---- desktop ----------------------------------------------------------------------------

  listDesktops: async () => clone(desktopState.desktops),
  getDesktop: async (id) => clone(desktopState.desktops.find((d) => d.id === id) ?? null),

  createDesktop: async (name) => {
    const desktop: Desktop = {
      id: nextId('desktop'),
      name,
      wallpaper: null,
      grid: { cell: 96, gap: 16, snap: true, autoArrange: false },
      sortOrder: desktopState.desktops.length,
    };
    desktopState.desktops = [...desktopState.desktops, desktop];
    emitLocal('desktop://updated', { reason: 'desktop_created' });
    return clone(desktop);
  },

  updateDesktop: async (desktop) => {
    desktopState.desktops = desktopState.desktops.map((d) => (d.id === desktop.id ? desktop : d));
    emitLocal('desktop://updated', { reason: 'desktop_updated' });
    return clone(desktop);
  },

  deleteDesktop: async (id) => {
    if (desktopState.desktops.length <= 1) {
      throw { code: 'invalid', message: 'the last desktop cannot be deleted' };
    }
    desktopState.desktops = desktopState.desktops.filter((d) => d.id !== id);
    desktopState.items = desktopState.items.filter((i) => i.desktopId !== id);
    emitLocal('desktop://updated', { reason: 'desktop_deleted' });
  },

  listDesktopItems: async (desktopId) =>
    clone(
      desktopState.items
        .filter((i) => i.desktopId === desktopId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.y - b.y || a.x - b.x),
    ),

  addDesktopItem: async (input) => {
    const item: DesktopItem = {
      id: nextId('item'),
      desktopId: input.desktopId,
      kind: input.kind ?? 'shortcut',
      targetId: input.targetId ?? null,
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: Math.max(1, input.width ?? 1),
      height: Math.max(1, input.height ?? 1),
      labelOverride: input.labelOverride ?? null,
      iconOverride: input.iconOverride ?? null,
      sortOrder: 0,
    };
    desktopState.items = [...desktopState.items, item];
    emitLocal('desktop://updated', { reason: 'item_added' });
    return clone(item);
  },

  updateDesktopItem: async (id, patch) => {
    const current = desktopState.items.find((i) => i.id === id);
    if (!current) throw { code: 'not_found', message: `desktop item \`${id}\`` };
    // Absent means unchanged - mirrors the Rust patch semantics exactly.
    const next: DesktopItem = {
      ...current,
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      width: Math.max(1, patch.width ?? current.width),
      height: Math.max(1, patch.height ?? current.height),
      labelOverride: patch.labelOverride !== undefined ? patch.labelOverride : current.labelOverride,
      iconOverride: patch.iconOverride !== undefined ? patch.iconOverride : current.iconOverride,
      sortOrder: patch.sortOrder ?? current.sortOrder,
    };
    desktopState.items = desktopState.items.map((i) => (i.id === id ? next : i));
    emitLocal('desktop://updated', { reason: 'item_moved' });
    return clone(next);
  },

  removeDesktopItem: async (id) => {
    desktopState.items = desktopState.items.filter((i) => i.id !== id);
    emitLocal('desktop://updated', { reason: 'item_removed' });
  },

  // ---- folders ----------------------------------------------------------------------------

  listFolders: async () => clone(desktopState.folders),
  getFolder: async (id) => clone(desktopState.folders.find((f) => f.id === id) ?? null),

  createFolder: async (input) => {
    const kind = input.kind ?? 'filesystem';
    if (kind === 'filesystem' && !input.path?.trim()) {
      throw { code: 'invalid', message: 'a filesystem folder needs a path' };
    }
    const id = nextId('folder');
    const slug = (input.label ?? id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const folder: Folder = {
      id,
      path:
        kind === 'filesystem'
          ? input.path!.trim()
          : kind === 'collection'
            ? `collection:${input.collectionId ?? id}`
            : `smart:${slug || id}`,
      label: input.label ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      cover: input.cover ?? null,
      layout: input.layout ?? 'grid',
      shape: input.shape ?? null,
      kind,
      collectionId: input.collectionId ?? null,
      filter: input.filter ?? null,
      windowState: null,
      sortOrder: desktopState.folders.length,
    };
    desktopState.folders = [...desktopState.folders, folder];
    emitLocal('desktop://updated', { reason: 'folder_created' });
    return clone(folder);
  },

  updateFolder: async (id, patch) => {
    const current = desktopState.folders.find((f) => f.id === id);
    if (!current) throw { code: 'not_found', message: `folder \`${id}\`` };
    const pick = <T,>(next: T | null | undefined, prev: T | null): T | null =>
      next !== undefined ? (next as T | null) : prev;
    const next: Folder = {
      ...current,
      label: pick(patch.label, current.label),
      color: pick(patch.color, current.color),
      icon: pick(patch.icon, current.icon),
      cover: pick(patch.cover, current.cover),
      shape: pick(patch.shape, current.shape),
      layout: patch.layout ?? current.layout,
      filter: pick(patch.filter, current.filter),
      collectionId: pick(patch.collectionId, current.collectionId),
      windowState: pick(patch.windowState, current.windowState),
      sortOrder: patch.sortOrder ?? current.sortOrder,
    };
    desktopState.folders = desktopState.folders.map((f) => (f.id === id ? next : f));
    emitLocal('desktop://updated', { reason: 'folder_updated' });
    return clone(next);
  },

  setFolderCover: async (id, path) => {
    /*
     * There is no file system to copy into here, so the mock stores the path it was handed. What
     * it does model is the *shape* of the call - one command, returning the updated folder - so
     * the editor's code path is the same in the browser as in the app, where the host copies the
     * file into the artwork cache first and stores the cached path instead.
     */
    return mockApi.updateFolder(id, { cover: path });
  },

  deleteFolder: async (id) => {
    desktopState.folders = desktopState.folders.filter((f) => f.id !== id);
    // Same pruning the core does: an item pointing at a gone folder would open nothing.
    desktopState.items = desktopState.items.filter(
      (i) => !(i.kind === 'folder' && i.targetId === id),
    );
    emitLocal('desktop://updated', { reason: 'folder_deleted' });
  },

  folderContents: async (id) => {
    const folder = desktopState.folders.find((f) => f.id === id);
    if (!folder) throw { code: 'not_found', message: `folder \`${id}\`` };
    if (folder.kind === 'smart') return clone(applyFilter(library, folder.filter ?? undefined));
    if (folder.kind === 'collection') return [];
    return []; // filesystem: the browser is V2
  },

  // ---- taskbar ----------------------------------------------------------------------------

  listTaskbarItems: async () =>
    clone([...desktopState.taskbar].sort((a, b) => a.sortOrder - b.sortOrder)),

  pinToTaskbar: async (targetId) => {
    const existing = desktopState.taskbar.find(
      (i) => i.kind === 'pinned' && i.targetId === targetId,
    );
    if (existing) return clone(existing);
    const item: TaskbarItem = {
      id: nextId('pin'),
      kind: 'pinned',
      targetId,
      sortOrder: Math.max(-1, ...desktopState.taskbar.map((i) => i.sortOrder)) + 1,
    };
    desktopState.taskbar = [...desktopState.taskbar, item];
    emitLocal('desktop://updated', { reason: 'taskbar_pinned' });
    return clone(item);
  },

  unpinFromTaskbar: async (targetId) => {
    desktopState.taskbar = desktopState.taskbar.filter(
      (i) => !(i.kind === 'pinned' && i.targetId === targetId),
    );
    emitLocal('desktop://updated', { reason: 'taskbar_unpinned' });
  },

  reorderTaskbar: async (ids) => {
    desktopState.taskbar = desktopState.taskbar.map((i) => {
      const at = ids.indexOf(i.id);
      return at < 0 ? i : { ...i, sortOrder: at };
    });
    emitLocal('desktop://updated', { reason: 'taskbar_reordered' });
  },

  /*
   * A slowly draining laptop, so the system area can be seen doing something in the browser.
   * The real reading comes from `GetSystemPowerStatus`; this only has to be plausible and to
   * exercise the same shapes - including a battery that is present but discharging.
   */
  getSystemStatus: async () => {
    const minutes = Date.now() / 60000;
    return {
      batteryPercent: 40 + Math.round(40 * Math.abs(Math.sin(minutes / 30))),
      charging: Math.floor(minutes / 5) % 2 === 0,
      hasBattery: true,
      // The browser's clock stands in for the host's. `utcOffsetMinutes` has the opposite sign
      // to `getTimezoneOffset`, which counts minutes to *add to local time* to reach UTC.
      epochMs: Date.now(),
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
    };
  },

  listThemes: async () => Object.values(THEMES).map((bundle) => clone(bundle.info)),
  getTheme: async (id) => clone(themeBundleFor(id)),
  setActiveTheme: async (id) => {
    // Mirrors the core: an unknown theme is refused *before* `themeId` is written, so a bad
    // id can never be stored and then fail on every start.
    const bundle = THEMES[id];
    if (!bundle) throw { code: 'not_found', message: `theme \`${id}\`` };
    settings = { ...settings, themeId: id };
    saveSettings(settings);
    emitLocal('theme://changed', { themeId: id });
    return clone(bundle);
  },

  // A browser has no global shortcuts, so the mock reports the honest answer: not registered,
  // with a reason. That keeps the "hotkey is not armed" UI path visible during `npm run dev`.
  getExitHotkeyStatus: async () => ({
    accelerator: settings.exitHotkey,
    registered: false,
    error: 'global shortcuts are only available in the desktop app',
  }),

  getMonitors: async () => [
    { name: 'Mock Display', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: true },
  ],

  // A tab can go fullscreen for real, so the mock does: F11 and the Settings row can be tried
  // in `npm run dev`. The preference is written exactly as the host writes it.
  setFullscreen: async (fullscreen) => {
    try {
      if (fullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!fullscreen && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Refused without a user gesture, or no DOM at all; the preference is still recorded.
    }
    if (settings.startFullscreen !== fullscreen) {
      settings = { ...settings, startFullscreen: fullscreen };
      saveSettings(settings);
    }
  },
  shellReady: async () => {},
  exitShell: async () => {
    emitLocal('shell://toast', { level: 'info', message: 'Exit is only available in the app' });
  },
  minimizeShell: async () => {},
  getWindowState: async () => mockWindowState(),
  toggleMaximizeShell: async () => {
    mockMaximized = !mockMaximized;
    return mockWindowState();
  },

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
