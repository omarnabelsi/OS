/**
 * Typed event subscription. Inside Tauri this wraps `listen`; in the browser mock the same
 * names are dispatched on a local emitter so UI code is identical in both environments.
 */

import type { CoreEventMap, CoreEventName } from './types';
import { isTauri } from './env';

type Handler<K extends CoreEventName> = (payload: CoreEventMap[K]) => void;
type Unsubscribe = () => void;

const local = new Map<CoreEventName, Set<Handler<CoreEventName>>>();

/** Dispatch an event locally (mock + tests). No-op effect on Tauri listeners. */
export function emitLocal<K extends CoreEventName>(name: K, payload: CoreEventMap[K]): void {
  const set = local.get(name);
  if (!set) return;
  for (const h of Array.from(set)) (h as Handler<K>)(payload);
}

export function onCoreEvent<K extends CoreEventName>(name: K, handler: Handler<K>): Unsubscribe {
  // Local emitter (always registered so tests/mocks can drive the UI).
  let set = local.get(name);
  if (!set) {
    set = new Set();
    local.set(name, set);
  }
  set.add(handler as Handler<CoreEventName>);
  let removeLocal: Unsubscribe = () => set?.delete(handler as Handler<CoreEventName>);

  if (!isTauri()) return removeLocal;

  let disposed = false;
  let unlisten: Unsubscribe | null = null;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<CoreEventMap[K]>(name, (e) => handler(e.payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }),
  );
  const removeTauri = () => {
    disposed = true;
    unlisten?.();
  };
  const removeBoth = () => {
    removeLocal();
    removeTauri();
  };
  removeLocal = removeBoth;
  return removeBoth;
}
