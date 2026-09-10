/**
 * Desktop store: the surface, what sits on it, the folders it points at, and the taskbar.
 *
 * The core is the source of truth; this holds the last snapshot and reacts to `desktop://updated`
 * by reloading. Moves are **optimistic** - a dragged icon must land under the cursor on the same
 * frame, not after a round trip - and roll back to the server's answer if the write fails.
 *
 * Positions are grid cells throughout. Nothing in this file knows about pixels; that conversion
 * belongs to the surface component, which is the only thing that knows how big a cell is.
 */

import { create } from 'zustand';

import { api, onCoreEvent } from '@/bridge';
import type {
  Desktop,
  DesktopItem,
  DesktopItemPatch,
  Folder,
  FolderPatch,
  FolderWindowState,
  LibraryItem,
  NewDesktopItem,
  NewFolder,
  TaskbarItem,
} from '@/bridge';

import { errorMessage } from './errors';

export interface DesktopState {
  desktops: Desktop[];
  /** The surface being shown. Null until `load()` finishes. */
  activeId: string | null;
  items: DesktopItem[];
  folders: Folder[];
  taskbar: TaskbarItem[];
  loaded: boolean;
  error: string | null;

  load(): Promise<void>;
  setActive(id: string): Promise<void>;

  /** Move an item to a grid cell. Optimistic; rolls back if the core refuses. */
  moveItem(id: string, x: number, y: number): Promise<void>;
  patchItem(id: string, patch: DesktopItemPatch): Promise<void>;
  addItem(input: NewDesktopItem): Promise<DesktopItem | null>;
  removeItem(id: string): Promise<void>;

  folderById(id: string | null | undefined): Folder | undefined;
  folderContents(id: string): Promise<LibraryItem[]>;
  /** Edit a folder. Optimistic, like `patchItem`: the live preview must not wait on a round trip. */
  patchFolder(id: string, patch: FolderPatch): Promise<void>;
  createFolder(input: NewFolder): Promise<Folder | null>;
  deleteFolder(id: string): Promise<void>;
  /**
   * Remember where a folder's window was. Deliberately silent: this is bookkeeping the user did
   * not ask for, so a failure must not raise an error banner over a window they are still using.
   */
  rememberWindowState(id: string, state: FolderWindowState): Promise<void>;

  /** Pin an entry to the taskbar, or remove it. Optimistic. */
  pinToTaskbar(targetId: string): Promise<void>;
  unpinFromTaskbar(targetId: string): Promise<void>;

  /** Subscribe to core events. Ref-counted; returns unsubscribe. */
  bindEvents(): () => void;
}

// ---- helpers -----------------------------------------------------------------------------------

/**
 * Drop absent keys so a patch can be spread over the current value.
 *
 * A patch says "leave this alone" with an absent key, but `{...current, ...patch}` would let an
 * explicit `undefined` overwrite a real value with nothing. `null` is kept: for these fields it
 * means "clear it", which is a change the user asked for.
 */
function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function replace<T extends { id: string }>(list: T[], next: T): T[] {
  const i = list.findIndex((x) => x.id === next.id);
  if (i < 0) return list;
  const copy = list.slice();
  copy[i] = next;
  return copy;
}

let bindCount = 0;
let unbinders: Array<() => void> = [];

// ---- store -------------------------------------------------------------------------------------

export const useDesktopStore = create<DesktopState>()((set, get) => ({
  desktops: [],
  activeId: null,
  items: [],
  folders: [],
  taskbar: [],
  loaded: false,
  error: null,

  async load() {
    try {
      const [desktops, folders, taskbar] = await Promise.all([
        api.listDesktops(),
        api.listFolders(),
        api.listTaskbarItems(),
      ]);
      // Keep the current surface selected across a reload; fall back to the first.
      const activeId =
        (get().activeId && desktops.some((d) => d.id === get().activeId) ? get().activeId : null) ??
        desktops[0]?.id ??
        null;
      const items = activeId ? await api.listDesktopItems(activeId) : [];
      set({ desktops, folders, taskbar, activeId, items, loaded: true, error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not load the desktop'), loaded: true });
    }
  },

  async setActive(id) {
    set({ activeId: id });
    try {
      set({ items: await api.listDesktopItems(id), error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not open that desktop') });
    }
  },

  async moveItem(id, x, y) {
    return get().patchItem(id, { x, y });
  },

  async patchItem(id, patch) {
    const before = get().items;
    const current = before.find((i) => i.id === id);
    if (!current) return;

    // Optimistic: the icon has to be under the cursor now, not after a round trip.
    const optimistic: DesktopItem = {
      ...current,
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      width: patch.width ?? current.width,
      height: patch.height ?? current.height,
    };
    set({ items: replace(before, optimistic) });

    try {
      const saved = await api.updateDesktopItem(id, patch);
      set({ items: replace(get().items, saved), error: null });
    } catch (e) {
      // Snap back to what the core last confirmed rather than leaving a lie on screen.
      set({ items: before, error: errorMessage(e, 'Could not move that') });
    }
  },

  async addItem(input) {
    try {
      const item = await api.addDesktopItem(input);
      set({ items: [...get().items, item], error: null });
      return item;
    } catch (e) {
      set({ error: errorMessage(e, 'Could not add that to the desktop') });
      return null;
    }
  },

  async removeItem(id) {
    const before = get().items;
    set({ items: before.filter((i) => i.id !== id) });
    try {
      await api.removeDesktopItem(id);
    } catch (e) {
      set({ items: before, error: errorMessage(e, 'Could not remove that') });
    }
  },

  folderById(id) {
    if (!id) return undefined;
    return get().folders.find((f) => f.id === id);
  },

  folderContents(id) {
    return api.folderContents(id);
  },

  async patchFolder(id, patch) {
    const before = get().folders;
    const current = before.find((f) => f.id === id);
    if (!current) return;

    // Optimistic, so the editor's live preview updates on the keystroke rather than on the reply.
    set({ folders: replace(before, { ...current, ...stripUndefined(patch) } as Folder) });
    try {
      const saved = await api.updateFolder(id, patch);
      set({ folders: replace(get().folders, saved), error: null });
    } catch (e) {
      set({ folders: before, error: errorMessage(e, 'Could not save that folder') });
    }
  },

  async createFolder(input) {
    try {
      const folder = await api.createFolder(input);
      set({ folders: [...get().folders, folder], error: null });
      return folder;
    } catch (e) {
      set({ error: errorMessage(e, 'Could not create that folder') });
      return null;
    }
  },

  async deleteFolder(id) {
    const before = get().folders;
    set({ folders: before.filter((f) => f.id !== id) });
    try {
      await api.deleteFolder(id);
    } catch (e) {
      set({ folders: before, error: errorMessage(e, 'Could not delete that folder') });
    }
  },

  async rememberWindowState(id, windowState) {
    const current = get().folders.find((f) => f.id === id);
    if (!current) return;
    set({ folders: replace(get().folders, { ...current, windowState }) });
    try {
      await api.updateFolder(id, { windowState });
    } catch {
      // Silent by design - see the interface. The window is still where the user put it; only
      // the memory of it is lost, and it will be written again on the next settle.
    }
  },

  async pinToTaskbar(targetId) {
    const before = get().taskbar;
    try {
      const item = await api.pinToTaskbar(targetId);
      // The core is free to return an existing pin rather than a new one.
      set({
        taskbar: before.some((t) => t.id === item.id) ? replace(before, item) : [...before, item],
        error: null,
      });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not pin that') });
    }
  },

  async unpinFromTaskbar(targetId) {
    const before = get().taskbar;
    set({ taskbar: before.filter((t) => t.targetId !== targetId) });
    try {
      await api.unpinFromTaskbar(targetId);
    } catch (e) {
      set({ taskbar: before, error: errorMessage(e, 'Could not unpin that') });
    }
  },

  bindEvents() {
    if (bindCount++ === 0) {
      unbinders = [
        // Coarse by design: reload the arrangement rather than patching it. These fire on user
        // actions, never on a drag frame, so a reload per event is cheap.
        onCoreEvent('desktop://updated', () => {
          void get().load();
        }),
        // A removed entry can orphan a shortcut; the core prunes, so re-read.
        onCoreEvent('library://updated', () => {
          if (get().loaded) void get().load();
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
