/**
 * IPC contract - TypeScript mirror of `crates/aura-core/src/model.rs` (+ `config/settings.rs`).
 * Fields are camelCase, enum variants snake_case. Change both sides together; see docs/IPC.md.
 */

// ---- app ------------------------------------------------------------------------------------

export type ShellMode = 'overlay' | 'true_shell';

export interface AppInfo {
  version: string;
  dataDir: string;
  cacheDir: string;
  artworkDir: string;
  themesDir: string;
  userThemesDir: string;
  mode: ShellMode;
  smoke: boolean;
}

export interface IpcError {
  code:
    | 'io'
    | 'db'
    | 'json'
    | 'http'
    | 'not_found'
    | 'invalid'
    | 'theme'
    | 'launch'
    | 'unsupported'
    | 'other';
  message: string;
}

export function isIpcError(e: unknown): e is IpcError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

// ---- settings -------------------------------------------------------------------------------

export type TileSize = 'small' | 'medium' | 'large';

export type WallpaperSetting =
  | { kind: 'theme' }
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string; muted: boolean }
  | { kind: 'shader'; id: string }
  | { kind: 'color'; hex: string };

export interface Settings {
  themeId: string;
  wallpaper: WallpaperSetting;
  accentColor: string | null;
  tileSize: TileSize;
  uiScale: number;
  soundVolume: number;
  musicVolume: number;
  soundsEnabled: boolean;
  exitHotkey: string;
  steamgriddbApiKey: string | null;
  hideShellOnLaunch: boolean;
  startFullscreen: boolean;
  alwaysOnTop: boolean;
  monitorIndex: number | null;
  gamepadEnabled: boolean;
  reduceMotion: boolean;
  scanOnStartup: boolean;
  language: string;
}

export type SettingsPatch = Partial<Settings>;

// ---- library --------------------------------------------------------------------------------

export type EntryType = 'game' | 'app' | 'link' | 'folder';
export type Source = 'steam' | 'epic' | 'gog' | 'ea' | 'uwp' | 'manual';

export type LaunchSpec =
  | { kind: 'exe'; path: string; args: string[]; cwd: string | null }
  | { kind: 'uri'; uri: string }
  | { kind: 'shell'; target: string };

export interface Entry {
  id: string;
  name: string;
  type: EntryType;
  source: Source;
  sourceId: string | null;
  launch: LaunchSpec;
  installPath: string | null;
  installSize: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ArtworkKind = 'grid' | 'hero' | 'logo' | 'icon';

export interface Artwork {
  grid: string | null;
  hero: string | null;
  logo: string | null;
  icon: string | null;
  source: string | null;
  userOverride: boolean;
}

export interface Stats {
  playtimeSecs: number;
  launchCount: number;
  lastPlayed: number | null;
  favourite: boolean;
  hidden: boolean;
}

/** Entry + artwork + stats. `Entry` fields are flattened onto the item. */
export interface LibraryItem extends Entry {
  artwork: Artwork;
  stats: Stats;
}

export type SortKey = 'name' | 'last_played' | 'playtime' | 'recently_added';

export interface EntryFilter {
  type?: EntryType | null;
  source?: Source | null;
  includeHidden?: boolean;
  favouritesOnly?: boolean;
  search?: string | null;
  sort?: SortKey;
  limit?: number | null;
}

export interface AddManualEntryInput {
  name?: string | null;
  path: string;
  args?: string[];
  type?: EntryType | null;
}

export interface UpdateEntryPatch {
  name?: string | null;
  hidden?: boolean | null;
  favourite?: boolean | null;
  launch?: LaunchSpec | null;
}

// ---- events payloads ------------------------------------------------------------------------

export type ScanStage = 'queued' | 'discovering' | 'parsing' | 'saving' | 'done' | 'error';

export interface ScanProgress {
  jobId: string;
  source: Source | null;
  stage: ScanStage;
  found: number;
  message: string | null;
  done: boolean;
}

export interface LibraryUpdated {
  entryIds: string[];
  reason: 'scan' | 'manual_add' | 'update' | 'remove' | string;
}

export interface ArtworkUpdated {
  entryId: string;
  kind: ArtworkKind;
  path: string;
  source: string;
}

export interface LaunchSession {
  sessionId: string;
  entryId: string;
  pid: number | null;
  startedAt: number;
}

export interface ProcessExited {
  sessionId: string;
  entryId: string;
  exitCode: number | null;
  durationSecs: number;
}

export type ToastLevel = 'info' | 'warning' | 'error';

export interface Toast {
  level: ToastLevel;
  message: string;
}

export interface ThemeChanged {
  themeId: string;
}

export interface HotkeyEvent {
  action: 'exit' | string;
}

// ---- input ----------------------------------------------------------------------------------

export type GamepadEventKind = 'connected' | 'disconnected' | 'button' | 'axis';

export type GamepadButton =
  | 'south'
  | 'east'
  | 'north'
  | 'west'
  | 'dpad_up'
  | 'dpad_down'
  | 'dpad_left'
  | 'dpad_right'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_trigger'
  | 'right_trigger'
  | 'start'
  | 'select'
  | 'guide'
  | 'left_stick'
  | 'right_stick';

export type GamepadAxis = 'left_x' | 'left_y' | 'right_x' | 'right_y';

export interface GamepadEvent {
  gamepadId: number;
  kind: GamepadEventKind;
  button: GamepadButton | null;
  axis: GamepadAxis | null;
  value: number;
  pressed: boolean;
  name: string | null;
}

// ---- shell host -----------------------------------------------------------------------------

export interface MonitorInfo {
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

// ---- themes ---------------------------------------------------------------------------------

export interface ThemeInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  screenshots: string[];
  path: string;
  builtin: boolean;
  minAppVersion: string | null;
}

/** Shape of tokens.json. Kept loose on purpose: themes may add keys, the UI reads what it knows. */
export interface ThemeTokens {
  color?: Record<string, string>;
  radius?: Record<string, string | number>;
  blur?: Record<string, string | number>;
  spacing?: Record<string, string | number>;
  easing?: Record<string, string>;
  duration?: Record<string, string | number>;
  tile?: Record<string, string | number>;
  font?: Record<string, string>;
  [group: string]: Record<string, string | number> | undefined;
}

/** Shape of layout.json. */
export interface ThemeLayout {
  regions?: string[];
  navBar?: { position?: 'top' | 'bottom'; items?: string[] };
  home?: { rows?: Array<{ id: string; title?: string; source?: string; filter?: EntryFilter }> };
  background?: WallpaperSetting | { kind: 'video'; path: string; muted?: boolean } | { kind: 'image'; path: string } | { kind: 'shader'; id: string };
  [key: string]: unknown;
}

export interface ThemeBundle {
  info: ThemeInfo;
  tokens: ThemeTokens;
  layout: ThemeLayout;
  css: string;
  /** sound name -> absolute path */
  sounds: Record<string, string>;
  /** shader id -> GLSL source */
  shaders: Record<string, string>;
  assetsDir: string;
}

// ---- event names ----------------------------------------------------------------------------

export interface CoreEventMap {
  'library://scan-progress': ScanProgress;
  'library://updated': LibraryUpdated;
  'library://artwork': ArtworkUpdated;
  'process://started': LaunchSession;
  'process://exited': ProcessExited;
  'input://gamepad': GamepadEvent;
  'theme://changed': ThemeChanged;
  'shell://toast': Toast;
  'shell://hotkey': HotkeyEvent;
}

export type CoreEventName = keyof CoreEventMap;
