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
  Desktop,
  DesktopItem,
  DesktopItemPatch,
  EntryFilter,
  ExitHotkeyStatus,
  Folder,
  FolderPatch,
  LaunchSession,
  LibraryItem,
  MonitorInfo,
  NewDesktopItem,
  NewFolder,
  Settings,
  SettingsPatch,
  Source,
  ShellWindowState,
  SystemStatus,
  TaskbarItem,
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

  // desktop - positions are grid cells, not pixels
  listDesktops(): Promise<Desktop[]>;
  getDesktop(id: string): Promise<Desktop | null>;
  createDesktop(name: string): Promise<Desktop>;
  updateDesktop(desktop: Desktop): Promise<Desktop>;
  deleteDesktop(id: string): Promise<void>;
  listDesktopItems(desktopId: string): Promise<DesktopItem[]>;
  addDesktopItem(input: NewDesktopItem): Promise<DesktopItem>;
  /** Absent fields are left alone, so a drop sends only `{ x, y }`. */
  updateDesktopItem(id: string, patch: DesktopItemPatch): Promise<DesktopItem>;
  removeDesktopItem(id: string): Promise<void>;

  // folders
  listFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder | null>;
  createFolder(input: NewFolder): Promise<Folder>;
  updateFolder(id: string, patch: FolderPatch): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** Smart filter results, collection members, or empty for a filesystem folder (V2). */
  folderContents(id: string): Promise<LibraryItem[]>;

  // taskbar - pinned and structural only; "running" is derived in the UI
  listTaskbarItems(): Promise<TaskbarItem[]>;
  pinToTaskbar(targetId: string): Promise<TaskbarItem>;
  unpinFromTaskbar(targetId: string): Promise<void>;
  reorderTaskbar(ids: string[]): Promise<void>;
  /** The power state behind the system area. Polled; never throws on a machine that has none. */
  getSystemStatus(): Promise<SystemStatus>;

  // themes
  listThemes(): Promise<ThemeInfo[]>;
  /** Omit `id` for the active theme. */
  getTheme(id?: string): Promise<ThemeBundle>;
  setActiveTheme(id: string): Promise<ThemeBundle>;

  // shell host
  /** Whether the exit hotkey is actually claimed from the OS, not just stored in Settings. */
  getExitHotkeyStatus(): Promise<ExitHotkeyStatus>;
  getMonitors(): Promise<MonitorInfo[]>;
  /** Enter or leave fullscreen now, and remember it as the preference (`startFullscreen`). */
  setFullscreen(fullscreen: boolean): Promise<void>;
  /** Call once after first paint; shows the (initially hidden) window. */
  shellReady(): Promise<void>;
  exitShell(): Promise<void>;
  minimizeShell(): Promise<void>;
  /** The native window's state. The shell's title bar is drawn only when it is not fullscreen. */
  getWindowState(): Promise<ShellWindowState>;
  /** Maximise or restore the *windowed* shell. Never fullscreen - that is `setFullscreen`. */
  toggleMaximizeShell(): Promise<ShellWindowState>;

  // host dialogs (plugin-dialog in Tauri, <input type=file> shim in the mock)
  pickFile(kind: 'exe' | 'image' | 'video' | 'any'): Promise<string | null>;
}
