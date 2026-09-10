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
  /*
   * `const`, not `let`. This was previously reassigned to the combined unsubscribe below, which
   * made that function call itself: every cleanup blew the stack, and under React's development
   * double-invoke that happens on the very first mount - the whole shell rendered a blank page.
   */
  const removeLocal: Unsubscribe = () => {
    set.delete(handler as Handler<CoreEventName>);
  };

  if (!isTauri()) return removeLocal;

  let disposed = false;
  let unlisten: Unsubscribe | null = null;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<CoreEventMap[K]>(name, (e) => handler(e.payload)).then((fn) => {
      // Unsubscribed while the listener was still being registered: drop it on arrival.
      if (disposed) fn();
      else unlisten = fn;
    }),
  );

  // Idempotent: React can call a cleanup more than once, and `listen`'s own unlisten is not
  // safe to run twice.
  return () => {
    if (disposed) return;
    disposed = true;
    removeLocal();
    unlisten?.();
    unlisten = null;
  };
}
