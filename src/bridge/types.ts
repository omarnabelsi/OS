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

/**
 * A video wallpaper carries no `muted` flag on purpose: the app has no music playback, so there is
 * nothing to unmute. `Background` hard-mutes the element. See `WallpaperSetting` in
 * `crates/aura-core/src/config/settings.rs`.
 */
export type WallpaperSetting =
  | { kind: 'theme' }
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string }
  | { kind: 'shader'; id: string }
  | { kind: 'color'; hex: string };

export interface Settings {
  themeId: string;
  wallpaper: WallpaperSetting;
  accentColor: string | null;
  tileSize: TileSize;
  uiScale: number;
  soundVolume: number;
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
  taskbarVisible: boolean;
  taskbarPosition: TaskbarPosition;
  taskbarAlignment: TaskbarAlignment;
}

/**
 * Which edge Aura's own taskbar is docked to. The real Windows taskbar is never moved or
 * hidden - Aura runs as an overlay, not as the shell (docs/RISKS.md R3, R13).
 */
export type TaskbarPosition = 'top' | 'bottom' | 'left' | 'right';
/** Where the buttons sit along that edge. Windows 11 centres them; Windows 10 did not. */
export type TaskbarAlignment = 'start' | 'center';

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

// ---- desktop --------------------------------------------------------------------------------

export interface GridSettings {
  /** Cell size in logical pixels. Item positions are in cells, so this can change freely. */
  cell: number;
  gap: number;
  snap: boolean;
  autoArrange: boolean;
}

/**
 * One named arrangement of items over the wallpaper. Plural from the start (workspaces), even
 * though a seeded install has exactly one.
 */
export interface Desktop {
  id: string;
  name: string;
  /** Overrides the wallpaper from settings/theme for this desktop only. */
  wallpaper: WallpaperSetting | null;
  grid: GridSettings;
  sortOrder: number;
}

export type DesktopItemKind = 'shortcut' | 'folder' | 'widget' | 'separator';

/**
 * Something the user placed on a desktop.
 *
 * `x`/`y`/`width`/`height` are **grid cells, not pixels** - an arrangement made at 1080p has to
 * survive plugging in a 4K monitor.
 */
export interface DesktopItem {
  id: string;
  desktopId: string;
  kind: DesktopItemKind;
  /** `Entry.id`, `Folder.id` or a widget id, depending on `kind`. */
  targetId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  labelOverride: string | null;
  iconOverride: string | null;
  sortOrder: number;
}

export interface NewDesktopItem {
  desktopId: string;
  kind?: DesktopItemKind;
  targetId?: string | null;
  x?: number;
  y?: number;
  width?: number | null;
  height?: number | null;
  labelOverride?: string | null;
  iconOverride?: string | null;
}

/** Absent means "leave alone", so a drop can send only `x` and `y`. */
export interface DesktopItemPatch {
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  labelOverride?: string | null;
  iconOverride?: string | null;
  sortOrder?: number | null;
}

// ---- folders --------------------------------------------------------------------------------

/**
 * - `filesystem` - a real path on disk (the V2 file browser).
 * - `collection` - a hand-made group of entries.
 * - `smart` - a saved `EntryFilter`; this is what the old home rows became.
 */
export type FolderKind = 'filesystem' | 'collection' | 'smart';
export type FolderLayout = 'grid' | 'list' | 'covers';

/** Where a folder's window was when it last closed. Written on settle, never on a drag frame. */
export interface FolderWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximised: boolean;
}

export interface Folder {
  id: string;
  /**
   * The unique locator. A filesystem path for `filesystem` folders; for virtual ones a scheme
   * prefix instead - `smart:all-games`, `collection:<uuid>`.
   */
  path: string;
  label: string | null;
  color: string | null;
  icon: string | null;
  cover: string | null;
  layout: FolderLayout;
  /** A shape id the active theme declares in `layout.json` `folderShapes`. */
  shape: string | null;
  kind: FolderKind;
  collectionId: string | null;
  filter: EntryFilter | null;
  windowState: FolderWindowState | null;
  sortOrder: number;
}

export interface NewFolder {
  path?: string | null;
  label?: string | null;
  kind?: FolderKind;
  collectionId?: string | null;
  filter?: EntryFilter | null;
  color?: string | null;
  icon?: string | null;
  cover?: string | null;
  shape?: string | null;
  layout?: FolderLayout;
}

/**
 * The folder editor's patch. Absent = leave it alone, `null` = clear it, a value = set it.
 *
 * The core keeps those three apart (`FolderPatch` in model.rs). It used to collapse the last two,
 * so `{ color: null }` read as "unchanged" and a colour or cover, once set, could not be removed.
 */
export interface FolderPatch {
  label?: string | null;
  color?: string | null;
  icon?: string | null;
  cover?: string | null;
  shape?: string | null;
  layout?: FolderLayout | null;
  filter?: EntryFilter | null;
  collectionId?: string | null;
  windowState?: FolderWindowState | null;
  sortOrder?: number | null;
}

// ---- taskbar --------------------------------------------------------------------------------

export type TaskbarItemKind = 'pinned' | 'system_area' | 'launcher';

/**
 * Only pinned and structural items are stored. Whether something is *running* is derived in the
 * UI from open windows plus `activeSessions`, so it can never go stale.
 */
export interface TaskbarItem {
  id: string;
  kind: TaskbarItemKind;
  targetId: string | null;
  sortOrder: number;
}

/**
 * What the taskbar's system area shows.
 *
 * Every field is optional or flagged because a desktop PC has no battery: "unknown" has to be
 * distinguishable from "flat", or a tower renders an empty battery forever. The clock is not
 * here - it is `new Date()` in the UI, since a round trip per second to learn the time the
 * webview already knows would be absurd.
 */
export interface SystemStatus {
  /** 0..=100, or null when there is no battery or Windows would not say. */
  batteryPercent: number | null;
  charging: boolean;
  hasBattery: boolean;
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

/**
 * The desktop surface changed. Coarse on purpose: the UI reloads the arrangement rather than
 * patching it, and these fire on user actions, never on a drag frame.
 */
export interface DesktopUpdated {
  reason: string;
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

/**
 * Whether the exit hotkey is really claimed from the OS.
 *
 * `accelerator` is what Settings asks for; `registered` is whether the OS agreed. They differ
 * whenever the combination is reserved (Windows keeps `Ctrl+Shift+Escape` for Task Manager) or
 * already taken by another application.
 */
export interface ExitHotkeyStatus {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

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

/** A folder shape a theme offers the folder editor. `asset` is relative to the theme folder. */
export interface ThemeFolderShape {
  id: string;
  asset: string;
}

/** Shape of layout.json. */
export interface ThemeLayout {
  regions?: string[];
  navBar?: { position?: 'top' | 'bottom'; items?: string[] };
  /**
   * The desktop surface. `grid` seeds `GridSettings` for a desktop that has none of its own;
   * `defaultItems` is what a first run lays down, addressed by folder *locator* so a theme can
   * refer to the seeded folders without knowing their generated ids.
   */
  desktop?: {
    grid?: { cell?: number; gap?: number; snap?: boolean };
    defaultItems?: Array<{ kind?: DesktopItemKind; folder?: string; entry?: string; x?: number; y?: number }>;
  };
  /** Shapes the folder editor offers. The picker enumerates these, never a hard-coded list. */
  folderShapes?: ThemeFolderShape[];
  home?: { rows?: Array<{ id: string; title?: string; source?: string; filter?: EntryFilter }> };
  /** A theme may declare a wallpaper, but never audio - see `WallpaperSetting`. */
  background?: WallpaperSetting | { kind: 'image'; path: string } | { kind: 'shader'; id: string };
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
  'desktop://updated': DesktopUpdated;
  'shell://toast': Toast;
  'shell://hotkey': HotkeyEvent;
}

export type CoreEventName = keyof CoreEventMap;
