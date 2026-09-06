/**
 * UI state that is not owned by the library or settings: the active screen, the focused item
 * (for hero panel / colour bleed), the open overlay, and toasts.
 *
 * Toasts: default TTL 4 s, at most `MAX_TOASTS` shown (oldest dropped), timers are cleared on
 * dismiss so nothing fires after unmount.
 */

import { create } from 'zustand';

import { onCoreEvent } from '@/bridge';
import type { ToastLevel } from '@/bridge';

export type ScreenId = 'home' | 'games' | 'apps' | 'files' | 'media' | 'settings';

export interface NavItem {
  id: ScreenId;
  label: string;
  /** SVG name under the theme's `assets/icons/` (e.g. `home` -> `assets/icons/home.svg`). */
  icon: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'games', label: 'Games', icon: 'games' },
  { id: 'apps', label: 'Apps', icon: 'apps' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export type OverlayId = null | 'addEntry' | 'artwork' | 'exit' | 'itemMenu';

export interface ToastItem {
  id: number;
  level: ToastLevel;
  message: string;
}

export const TOAST_TTL_MS = 4000;
export const MAX_TOASTS = 4;

export interface UiState {
  screen: ScreenId;
  setScreen(s: ScreenId): void;
  /** Cycle forward through `NAV_ITEMS` (wraps). */
  nextScreen(): void;
  /** Cycle backward through `NAV_ITEMS` (wraps). */
  prevScreen(): void;

  focusedItemId: string | null;
  setFocusedItem(id: string | null): void;

  overlay: OverlayId;
  setOverlay(o: OverlayId): void;

  toasts: ToastItem[];
  /** `ttlMs <= 0` (or non-finite) keeps the toast until dismissed. */
  pushToast(level: ToastLevel, message: string, ttlMs?: number): void;
  dismissToast(id: number): void;

  /** Subscribe `shell://toast` -> `pushToast`. Ref-counted; returns unsubscribe. */
  bindEvents(): () => void;
}

// ---- module-private ----------------------------------------------------------------------------

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearToastTimer(id: number): void {
  const t = toastTimers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    toastTimers.delete(id);
  }
}

function screenIndex(s: ScreenId): number {
  const i = NAV_ITEMS.findIndex((n) => n.id === s);
  return i < 0 ? 0 : i;
}

let bindCount = 0;
let unbind: (() => void) | null = null;

// ---- store -------------------------------------------------------------------------------------

export const useUiStore = create<UiState>()((set, get) => ({
  screen: 'home',
  setScreen: (screen) => set({ screen }),
  nextScreen: () => {
    const i = (screenIndex(get().screen) + 1) % NAV_ITEMS.length;
    set({ screen: NAV_ITEMS[i]!.id });
  },
  prevScreen: () => {
    const i = (screenIndex(get().screen) - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    set({ screen: NAV_ITEMS[i]!.id });
  },

  focusedItemId: null,
  setFocusedItem: (focusedItemId) => set({ focusedItemId }),

  overlay: null,
  setOverlay: (overlay) => set({ overlay }),

  toasts: [],
  pushToast: (level, message, ttlMs = TOAST_TTL_MS) => {
    const id = ++toastSeq;
    const next = [...get().toasts, { id, level, message }];
    while (next.length > MAX_TOASTS) {
      const dropped = next.shift();
      if (dropped) clearToastTimer(dropped.id);
    }
    set({ toasts: next });
    if (Number.isFinite(ttlMs) && ttlMs > 0) {
      toastTimers.set(
        id,
        setTimeout(() => {
          toastTimers.delete(id);
          get().dismissToast(id);
        }, ttlMs),
      );
    }
  },
  dismissToast: (id) => {
    clearToastTimer(id);
    const { toasts } = get();
    if (!toasts.some((t) => t.id === id)) return;
    set({ toasts: toasts.filter((t) => t.id !== id) });
  },

  bindEvents: () => {
    if (bindCount++ === 0) {
      // shell://hotkey is intentionally not handled here: the host exits the process itself.
      unbind = onCoreEvent('shell://toast', (t) => get().pushToast(t.level, t.message));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--bindCount === 0) {
        unbind?.();
        unbind = null;
      }
    };
  },
}));
