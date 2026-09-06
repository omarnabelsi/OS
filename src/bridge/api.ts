/**
 * The bridge interface the UI codes against. Two implementations:
 *  - `tauriApi.ts` : real, via `invoke` (inside the Aura Shell window)
 *  - `mock.ts`     : in-browser fake for `npm run dev` in a normal browser and for tests
 *
 * Method names are the Tauri command names in camelCase; argument objects use the camelCase
 * keys Tauri expects (`entryId`, not `entry_id`).
 */

import type {
  AddManualEntryInput,
  AppInfo,
  Artwork,
  ArtworkKind,
  EntryFilter,
  LaunchSession,
  LibraryItem,
  MonitorInfo,
  Settings,
  SettingsPatch,
  Source,
  ThemeBundle,
  ThemeInfo,
  UpdateEntryPatch,
} from './types';

export interface AuraApi {
  // app
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;

  // library
  listEntries(filter?: EntryFilter): Promise<LibraryItem[]>;
  getEntry(id: string): Promise<LibraryItem | null>;
  addManualEntry(input: AddManualEntryInput): Promise<LibraryItem>;
  updateEntry(id: string, patch: UpdateEntryPatch): Promise<LibraryItem>;
  removeEntry(id: string): Promise<void>;
  /** Returns the job id. Progress arrives on `library://scan-progress`. */
  scanLibrary(sources?: Source[]): Promise<string>;

  // artwork
  fetchArtwork(entryId: string, force?: boolean): Promise<void>;
  setArtworkOverride(entryId: string, kind: ArtworkKind, path: string): Promise<Artwork>;

  // process
  launchEntry(id: string): Promise<LaunchSession>;
  activeSessions(): Promise<LaunchSession[]>;

  // themes
  listThemes(): Promise<ThemeInfo[]>;
  /** Omit `id` for the active theme. */
  getTheme(id?: string): Promise<ThemeBundle>;
  setActiveTheme(id: string): Promise<ThemeBundle>;

  // shell host
  getMonitors(): Promise<MonitorInfo[]>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  /** Call once after first paint; shows the (initially hidden) window. */
  shellReady(): Promise<void>;
  exitShell(): Promise<void>;
  minimizeShell(): Promise<void>;

  // host dialogs (plugin-dialog in Tauri, <input type=file> shim in the mock)
  pickFile(kind: 'exe' | 'image' | 'video' | 'any'): Promise<string | null>;
}
