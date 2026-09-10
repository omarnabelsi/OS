/**
 * Unsubscribing, in both environments.
 *
 * The Tauri path had no test, and it shipped a function that called itself: `removeLocal` was
 * reassigned to the combined unsubscribe, so every cleanup recursed until the stack blew. React's
 * development double-invoke runs a cleanup on first mount, so the entire shell rendered a blank
 * page inside Tauri while the browser mock - which returns before that line - was fine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const unlisten = vi.fn();
const listen = vi.fn(async () => unlisten);

vi.mock('@tauri-apps/api/event', () => ({ listen }));

const { emitLocal, onCoreEvent } = await import('./events');

/** Make `isTauri()` true by giving `window` the marker it looks for. */
function asTauri(on: boolean) {
  if (on) (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
}

afterEach(() => {
  asTauri(false);
  vi.clearAllMocks();
});

describe('onCoreEvent', () => {
  it('stops delivering after unsubscribe in the browser', () => {
    const handler = vi.fn();
    const off = onCoreEvent('library://updated', handler);

    emitLocal('library://updated', { reason: 'scan', entryIds: [] });
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    emitLocal('library://updated', { reason: 'scan', entryIds: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes without recursing inside Tauri', async () => {
    asTauri(true);
    const handler = vi.fn();
    const off = onCoreEvent('library://updated', handler);
    await vi.waitFor(() => expect(listen).toHaveBeenCalled());

    // The regression: this threw RangeError: Maximum call stack size exceeded.
    expect(() => off()).not.toThrow();
    expect(unlisten).toHaveBeenCalledTimes(1);

    // The local emitter must be detached too, not just the Tauri listener.
    emitLocal('library://updated', { reason: 'scan', entryIds: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it('tolerates being unsubscribed twice, as React may do', async () => {
    asTauri(true);
    const off = onCoreEvent('library://updated', vi.fn());
    await vi.waitFor(() => expect(listen).toHaveBeenCalled());

    off();
    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('drops a listener that finished registering after unsubscribe', async () => {
    asTauri(true);
    const off = onCoreEvent('library://updated', vi.fn());
    // Unsubscribe before `listen` resolves - the window in which nothing can be cancelled yet.
    off();

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
