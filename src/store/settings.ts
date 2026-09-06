/**
 * Settings store.
 *
 * `update()` is optimistic and coalescing: the patch is applied to the local view immediately,
 * the bridge call is debounced (~120 ms, so a dragged slider produces one `update_settings`
 * round-trip), and on failure the failed batch is dropped so the view rolls back to the last
 * server-confirmed settings (plus any later, still-pending patches). The resolved promise from
 * `update()` settles when the batch containing that patch has completed - successfully or not;
 * failures are reported through `error`, not by rejecting, so slider-style callers need no
 * try/catch.
 *
 * Local view = committed (server) + inflight batch + pending batch.
 */

import { create } from 'zustand';

import { api } from '@/bridge';
import type { Settings, SettingsPatch } from '@/bridge';

import { errorMessage } from './errors';

export const SETTINGS_DEBOUNCE_MS = 120;

export interface SettingsState {
  /** Local (optimistic) view. `null` until `load()` or the first successful `update()`. */
  settings: Settings | null;
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Apply `patch` now, send it (debounced) - see file header for rollback semantics. */
  update(patch: SettingsPatch): Promise<void>;
  /** Send any pending patch immediately (e.g. before exiting). Resolves when done. */
  flush(): Promise<void>;
}

// ---- sync machinery (module-private, not reactive) ---------------------------------------------

let committed: Settings | null = null;
let inflight: SettingsPatch | null = null;
let pending: SettingsPatch = {};
let pendingWaiters: Array<() => void> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

function view(): Settings | null {
  if (!committed) return null;
  return { ...committed, ...(inflight ?? {}), ...pending };
}

function hasKeys(o: object): boolean {
  for (const _ in o) return true;
  return false;
}

async function runFlush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const waiters = pendingWaiters;
  pendingWaiters = [];
  if (!hasKeys(pending)) {
    for (const w of waiters) w();
    return;
  }
  const patch = pending;
  pending = {};
  inflight = patch;
  try {
    const result = await api.updateSettings(patch);
    committed = result;
    inflight = null;
    useSettingsStore.setState({ settings: view(), loaded: true, error: null });
  } catch (e) {
    // Rollback: drop the failed batch; later pending patches stay applied on top of `committed`.
    inflight = null;
    useSettingsStore.setState({ settings: view(), error: errorMessage(e, 'Could not save settings') });
  } finally {
    for (const w of waiters) w();
  }
}

function scheduleFlush(): Promise<void> {
  chain = chain.then(runFlush, runFlush);
  return chain;
}

// ---- store -------------------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  loaded: false,
  error: null,

  async load() {
    try {
      committed = await api.getSettings();
      set({ settings: view(), loaded: true, error: null });
    } catch (e) {
      set({ error: errorMessage(e, 'Could not load settings') });
    }
  },

  update(patch) {
    pending = { ...pending, ...patch };
    set({ settings: view() });
    if (timer) clearTimeout(timer);
    return new Promise<void>((resolve) => {
      pendingWaiters.push(resolve);
      timer = setTimeout(() => {
        timer = null;
        void scheduleFlush();
      }, SETTINGS_DEBOUNCE_MS);
    });
  },

  flush() {
    return scheduleFlush();
  },
}));
