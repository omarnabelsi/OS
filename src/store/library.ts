/**
 * Library store: the list of launchable items, plus the scan / launch lifecycle.
 *
 * The core is the source of truth. This store holds the last snapshot it sent us and reacts to
 * `library://*` and `process://*` events, so a scan running in the background updates the grid
 * without the UI polling. Mutations are optimistic where the round-trip would otherwise be
 * visible (favourite, hidden) and re-synced from the item the core returns.
 */

import { create } from 'zustand';

import { api, onCoreEvent } from '@/bridge';
import type {
  AddManualEntryInput,
  ArtworkKind,
  EntryFilter,
  LaunchSession,
  LibraryItem,
  ScanProgress,
  Source,
  UpdateEntryPatch,
} from '@/bridge';

import { errorMessage } from './errors';

export const DEFAULT_LIBRARY_FILTER: EntryFilter = { sort: 'name', includeHidden: false };

export interface LibraryViews {
  games: LibraryItem[];
  apps: LibraryItem[];
  recent: LibraryItem[];
  favourites: LibraryItem[];
}

export interface LibraryState {
  items: LibraryItem[];
  byId: Record<string, LibraryItem>;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  /** Progress of the current scan; `null` when nothing is scanning. */
  scan: ScanProgress | null;
  /** The session for a title we launched, while it runs. */
  session: LaunchSession | null;

  load(filter?: EntryFilter): Promise<void>;
  refresh(): Promise<void>;
  startScan(sources?: Source[]): Promise<void>;
  launch(id: string): Promise<void>;
  addManual(input: AddManualEntryInput): Promise<LibraryItem | null>;
  update(id: string, patch: UpdateEntryPatch): Promise<void>;
  remove(id: string): Promise<void>;
  toggleFavourite(id: string): Promise<void>;
  setHidden(id: string, hidden: boolean): Promise<void>;
  fetchArtwork(id: string, force?: boolean): Promise<void>;
  setArtwork(id: string, kind: ArtworkKind, path: string): Promise<void>;

  /** Subscribe to core events. Ref-counted; returns unsubscribe. */
  bindEvents(): () => void;
}

// ---- helpers -----------------------------------------------------------------------------------

function index(items: LibraryItem[]): Record<string, LibraryItem> {
  const byId: Record<string, LibraryItem> = {};
  for (const item of items) byId[item.id] = item;
  return byId;
}

/** Replace one item in place, keeping list order. Returns the same array if nothing matched. */
function replaceItem(items: LibraryItem[], next: LibraryItem): LibraryItem[] {
  const i = items.findIndex((it) => it.id === next.id);
  if (i < 0) return items;
  const copy = items.slice();
  copy[i] = next;
  return copy;
}

/** The filter the last `load()` used, so `refresh()` and event handlers stay consistent. */
let activeFilter: EntryFilter = DEFAULT_LIBRARY_FILTER;

// ---- selectors ---------------------------------------------------------------------------------

/**
 * Derived lists are recomputed only when `items` changes identity. Without this, every
 * `useLibraryStore(selectGames)` call would return a fresh array and re-render forever.
 */
function derive<T>(compute: (items: LibraryItem[]) => T): (state: LibraryState) => T {
  let lastItems: LibraryItem[] | null = null;
  let lastResult: T;
  return (state) => {
    if (state.items !== lastItems) {
      lastItems = state.items;
      lastResult = compute(state.items);
    }
    return lastResult;
  };
}

export const selectGames = derive((items) => items.filter((i) => i.type === 'game'));
export const selectApps = derive((items) => items.filter((i) => i.type === 'app'));

export const selectFavourites = derive((items) => items.filter((i) => i.stats.favourite));

/** Most recently played first; never-played items are left out entirely. */
export const selectRecent = derive((items) =>
  items
    .filter((i) => i.stats.lastPlayed !== null)
    .sort((a, b) => (b.stats.lastPlayed ?? 0) - (a.stats.lastPlayed ?? 0)),
);

export const selectById =
  (id: string | null) =>
  (state: LibraryState): LibraryItem | undefined =>
    id === null ? undefined : state.byId[id];

// ---- event binding ------------------------------------------------------------------------------

let bindCount = 0;
let unbinders: Array<() => void> = [];

// ---- store --------------------------------------------------------------------------------------

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  items: [],
  byId: {},
  loaded: false,
  loading: false,
  error: null,
  scan: null,
  session: null,

  async load(filter) {
    if (filter) activeFilter = filter;
    set({ loading: true });
    try {
      const items = await api.listEntries(activeFilter);
      set({ items, byId: index(items), loaded: true, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errorMessage(e, 'Could not load the library') });
    }
  },

  refresh() {
    return get().load();
  },

  async startScan(sources) {
    try {
      await api.scanLibrary(sources);
    } catch (e) {
      set({ error: errorMessage(e, 'Could not start the scan') });
    }
  },

  async launch(id) {
    try {
      const session = await api.launchEntry(id);
      set({ session, error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not launch that') });
    }
  },

  async addManual(input) {
    try {
      const item = await api.addManualEntry(input);
      const items = [...get().items, item];
      set({ items, byId: index(items), error: null });
      return item;
    } catch (e) {
      set({ error: errorMessage(e, 'Could not add that item') });
      return null;
    }
  },

  async update(id, patch) {
    try {
      const item = await api.updateEntry(id, patch);
      const items = replaceItem(get().items, item);
      set({ items, byId: index(items), error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not save that change') });
      // Pull the real state back so the optimistic edit does not linger.
      void get().refresh();
    }
  },

  async remove(id) {
    const previous = get().items;
    const items = previous.filter((i) => i.id !== id);
    set({ items, byId: index(items) });
    try {
      await api.removeEntry(id);
    } catch (e) {
      set({ items: previous, byId: index(previous), error: errorMessage(e, 'Could not remove that') });
    }
  },

  toggleFavourite(id) {
    const current = get().byId[id];
    if (!current) return Promise.resolve();

    // Optimistic: a star must light up on the same frame it is pressed.
    const optimistic: LibraryItem = {
      ...current,
      stats: { ...current.stats, favourite: !current.stats.favourite },
    };
    const items = replaceItem(get().items, optimistic);
    set({ items, byId: index(items) });

    return get().update(id, { favourite: optimistic.stats.favourite });
  },

  setHidden(id, hidden) {
    return get().update(id, { hidden });
  },

  async fetchArtwork(id, force = false) {
    try {
      await api.fetchArtwork(id, force);
    } catch (e) {
      set({ error: errorMessage(e, 'Could not fetch artwork') });
    }
  },

  async setArtwork(id, kind, path) {
    try {
      const artwork = await api.setArtworkOverride(id, kind, path);
      const current = get().byId[id];
      if (!current) return;
      const items = replaceItem(get().items, { ...current, artwork });
      set({ items, byId: index(items), error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not set that artwork') });
    }
  },

  bindEvents() {
    if (bindCount++ === 0) {
      unbinders = [
        onCoreEvent('library://updated', () => {
          void get().refresh();
        }),

        // Patch just the one asset rather than reloading the whole library: artwork arrives
        // one file at a time and a scan can produce hundreds of these.
        onCoreEvent('library://artwork', ({ entryId, kind, path, source }) => {
          const current = get().byId[entryId];
          if (!current) return;
          const next: LibraryItem = {
            ...current,
            artwork: { ...current.artwork, [kind]: path, source },
          };
          const items = replaceItem(get().items, next);
          set({ items, byId: index(items) });
        }),

        onCoreEvent('library://scan-progress', (progress) => {
          set({ scan: progress.done ? null : progress });
          if (progress.done) void get().refresh();
        }),

        onCoreEvent('process://started', (session) => set({ session })),

        onCoreEvent('process://exited', ({ sessionId }) => {
          if (get().session?.sessionId === sessionId) set({ session: null });
          // Playtime and lastPlayed changed underneath us.
          void get().refresh();
        }),
      ];
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--bindCount === 0) {
        for (const off of unbinders) off();
        unbinders = [];
      }
    };
  },
}));
