/**
 * Turn whatever the bridge rejected with (an `IpcError` `{ code, message }`, an `Error`, or a
 * bare string) into something a toast or an `error` field can show. Kept local to the store so
 * the stores only need `api` and `onCoreEvent` at runtime from '@/bridge' (tests mock those two).
 */

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (typeof e === 'string') return e || fallback;
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
