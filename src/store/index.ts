/**
 * State layer between the bridge and the components (zustand 5).
 *
 *   import { useLibraryStore, selectGames, useSettingsStore, useUiStore } from '@/store';
 */

export { useSettingsStore, SETTINGS_DEBOUNCE_MS } from './settings';
export type { SettingsState } from './settings';

export {
  useLibraryStore,
  selectGames,
  selectApps,
  selectRecent,
  selectFavourites,
  selectById,
  DEFAULT_LIBRARY_FILTER,
} from './library';
export type { LibraryState, LibraryViews } from './library';

export { useUiStore, NAV_ITEMS, TOAST_TTL_MS, MAX_TOASTS } from './ui';
export type { ScreenId, OverlayId, ToastItem, NavItem, UiState } from './ui';

export { useDesktopStore } from './desktop';
export type { DesktopState } from './desktop';
