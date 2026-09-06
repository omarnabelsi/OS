/**
 * Layer 3 from the UI's point of view. Import `api` and `onCoreEvent` from here and nowhere
 * else; components must never import `@tauri-apps/*` directly (keeps the UI runnable in a
 * browser and keeps themes/plugins away from native APIs).
 */

import type { AuraApi } from './api';
import { isTauri } from './env';
import { mockApi } from './mock';
import { tauriApi } from './tauriApi';

export const api: AuraApi = isTauri() ? tauriApi : mockApi;

export { onCoreEvent, emitLocal } from './events';
export { isTauri } from './env';
export type { AuraApi } from './api';
export * from './types';
