/**
 * Turn an absolute local path from the core (artwork cache, theme assets) into something an
 * <img>/<video>/<audio> can load. Inside Tauri that is the asset protocol; in the browser mock
 * paths are already URLs (data:, blob:, http:, or `/themes/...` served by Vite).
 */

import { isTauri } from '@/bridge/env';

let convert: ((p: string) => string) | null = null;
if (isTauri()) {
  void import('@tauri-apps/api/core').then((m) => {
    convert = m.convertFileSrc;
  });
}

export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(data|blob|https?|asset):/i.test(path) || path.startsWith('/')) return path;
  if (isTauri() && convert) return convert(path);
  // Fallback before the dynamic import resolves: Windows asset protocol URL form.
  if (isTauri()) return `http://asset.localhost/${encodeURIComponent(path)}`;
  return path;
}
