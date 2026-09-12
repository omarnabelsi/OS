/**
 * Every setting, as data.
 *
 * One definition, rendered in two places: the full-screen Settings screen and the windowed
 * Settings app. Before this existed the two would have been two copies of the same JSX, and
 * search would have had nothing to search. A row that is not in this list does not exist.
 *
 * `keywords` is for the words a user would type that the label does not contain - "brightness"
 * for interface scale, "battery" for the taskbar. Search covers label, hint and keywords.
 */

import type { ReactNode } from 'react';

import type {
  BlurMode,
  ExitHotkeyStatus,
  Settings,
  TaskbarAlignment,
  TaskbarPosition,
  ThemeInfo,
  TileSize,
} from '@/bridge';
import type { IconName } from '@/components/Icon';
import { Icon } from '@/components/Icon';

export interface SettingRowSpec {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  /** Words search should match beyond the label and hint. */
  keywords?: string;
  value?: ReactNode;
  onActivate?(): void;
  /** Left/right on the D-pad. Rows without this are toggles or actions. */
  onAdjust?(direction: -1 | 1): void;
}

export interface SettingsCategory {
  id: string;
  title: string;
  icon: IconName;
  rows: SettingRowSpec[];
}

export function Toggle({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className="aura-toggle" data-on={on || undefined}>
      <span className="aura-toggle-knob" />
    </span>
  );
}

const TILE_SIZES: TileSize[] = ['small', 'medium', 'large'];
const TASKBAR_POSITIONS: TaskbarPosition[] = ['bottom', 'top', 'left', 'right'];
const TASKBAR_ALIGNMENTS: TaskbarAlignment[] = ['center', 'start'];
const BLUR_MODES: BlurMode[] = ['auto', 'full', 'off'];
/** Said in terms of what the user sees, not the mode's name. */
const BLUR_LABELS: Record<BlurMode, string> = {
  auto: 'Automatic',
  full: 'Always on',
  off: 'Off',
};

/**
 * Combinations Windows will hand to an application, cycled by activating the Exit hotkey row.
 *
 * Deliberately excludes anything the OS keeps for itself - `Ctrl+Shift+Escape` (Task Manager),
 * `Ctrl+Alt+Delete`, `Ctrl+Esc`, `Alt+Tab`, the Win chords. `is_reserved_hotkey` in
 * crates/aura-core/src/config/settings.rs is the authority and rejects them at the boundary.
 */
export const EXIT_HOTKEY_CHOICES = [
  'Ctrl+Alt+Q',
  'Ctrl+Shift+Q',
  'Ctrl+Alt+X',
  'Ctrl+Shift+F12',
  'Ctrl+Alt+Backspace',
];

/** Step a numeric setting and keep it inside its range. */
export function step(value: number, direction: -1 | 1, min: number, max: number, size: number): number {
  const next = Math.round((value + direction * size) * 100) / 100;
  return Math.min(max, Math.max(min, next));
}

/** Move through a fixed list of choices, stopping at the ends rather than wrapping. */
function shift<T>(list: readonly T[], current: T, direction: -1 | 1): T {
  const at = list.indexOf(current);
  return list[Math.min(list.length - 1, Math.max(0, at + direction))] ?? current;
}

export interface CatalogContext {
  settings: Settings;
  set(patch: Partial<Settings>): void;
  /** The active theme's own name, which is friendlier than its id. */
  themeName: string;
  themeAuthor?: string;
  themes: ThemeInfo[];
  pickTheme(id: string): void;
  hotkey: ExitHotkeyStatus | null;
  cycleExitHotkey(): void;
  scanning: boolean;
  itemCount: number;
  startScan(): void;
  addProgram(): void;
  exitShell(): void;
}

export function buildCatalog(ctx: CatalogContext): SettingsCategory[] {
  const { settings, set } = ctx;
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return [
    {
      id: 'library',
      title: 'Library',
      icon: 'games',
      rows: [
        {
          id: 'scan',
          icon: 'games',
          label: 'Scan for games',
          hint: ctx.scanning ? 'Scanning…' : `${ctx.itemCount} items in your library`,
          keywords: 'steam refresh find import',
          value: <Icon name="play" size="0.9em" />,
          onActivate: ctx.startScan,
        },
        {
          id: 'add',
          icon: 'plus',
          label: 'Add a program',
          hint: 'Point Aura Shell at any .exe or shortcut',
          keywords: 'manual exe shortcut new',
          onActivate: ctx.addProgram,
        },
        {
          id: 'scanOnStartup',
          icon: 'settings',
          label: 'Scan on startup',
          hint: 'Refresh the library each time Aura Shell opens',
          value: <Toggle on={settings.scanOnStartup} />,
          onActivate: () => set({ scanOnStartup: !settings.scanOnStartup }),
        },
      ],
    },
    {
      id: 'appearance',
      title: 'Appearance',
      icon: 'palette',
      rows: [
        {
          id: 'theme',
          icon: 'palette',
          label: 'Theme',
          hint: ctx.themeAuthor
            ? `by ${ctx.themeAuthor}${ctx.themes.length > 1 ? ' — activate to switch' : ''}`
            : 'Activate to switch',
          keywords: 'skin colour style look',
          value: ctx.themeName,
          onActivate: () => {
            // Cycles rather than opening a picker: the list is short, and one control that
            // works with a D-pad beats a second panel that needs a pointer.
            const ids = ctx.themes.map((t) => t.id);
            if (ids.length < 2) return;
            const at = ids.indexOf(settings.themeId);
            ctx.pickTheme(ids[(at + 1) % ids.length]!);
          },
          onAdjust: (direction) => {
            const ids = ctx.themes.map((t) => t.id);
            if (ids.length < 2) return;
            ctx.pickTheme(shift(ids, settings.themeId, direction));
          },
        },
        {
          id: 'tileSize',
          icon: 'apps',
          label: 'Tile size',
          keywords: 'big small cover art',
          value: settings.tileSize,
          onAdjust: (direction) => set({ tileSize: shift(TILE_SIZES, settings.tileSize, direction) }),
          onActivate: () => {
            const at = TILE_SIZES.indexOf(settings.tileSize);
            set({ tileSize: TILE_SIZES[(at + 1) % TILE_SIZES.length]! });
          },
        },
        {
          id: 'uiScale',
          icon: 'settings',
          label: 'Interface scale',
          hint: 'Left and right to adjust',
          keywords: 'zoom text size bigger smaller dpi',
          value: percent(settings.uiScale),
          onAdjust: (direction) => set({ uiScale: step(settings.uiScale, direction, 0.5, 2, 0.05) }),
        },
        {
          id: 'reduceMotion',
          icon: 'media',
          label: 'Reduce motion',
          hint: 'Turn off animation and pause animated wallpapers',
          keywords: 'accessibility animation still',
          value: <Toggle on={settings.reduceMotion} />,
          onActivate: () => set({ reduceMotion: !settings.reduceMotion }),
        },
        {
          id: 'blurMode',
          icon: 'settings',
          label: 'Background blur',
          hint: 'Automatic drops blur when the frame rate cannot hold it',
          keywords: 'glass frosted performance fps transparency acrylic',
          value: BLUR_LABELS[settings.blurMode],
          onAdjust: (direction) => set({ blurMode: shift(BLUR_MODES, settings.blurMode, direction) }),
          onActivate: () => {
            const at = BLUR_MODES.indexOf(settings.blurMode);
            set({ blurMode: BLUR_MODES[(at + 1) % BLUR_MODES.length]! });
          },
        },
      ],
    },
    {
      id: 'desktop',
      title: 'Desktop',
      icon: 'desktop',
      rows: [
        {
          id: 'taskbarVisible',
          icon: 'desktop',
          label: 'Show the taskbar',
          hint: "Aura's own bar. The Windows taskbar is never touched.",
          keywords: 'bar dock hide',
          value: <Toggle on={settings.taskbarVisible} />,
          onActivate: () => set({ taskbarVisible: !settings.taskbarVisible }),
        },
        {
          id: 'taskbarPosition',
          icon: 'desktop',
          label: 'Taskbar edge',
          hint: 'Left and right to move it',
          keywords: 'top bottom side dock position',
          value: settings.taskbarPosition,
          onAdjust: (direction) =>
            set({ taskbarPosition: shift(TASKBAR_POSITIONS, settings.taskbarPosition, direction) }),
          onActivate: () => {
            const at = TASKBAR_POSITIONS.indexOf(settings.taskbarPosition);
            set({ taskbarPosition: TASKBAR_POSITIONS[(at + 1) % TASKBAR_POSITIONS.length]! });
          },
        },
        {
          id: 'taskbarAlignment',
          icon: 'desktop',
          label: 'Taskbar buttons',
          hint: 'Centred, as Windows 11 does, or from the start edge',
          keywords: 'centre center left align',
          value: settings.taskbarAlignment === 'center' ? 'centred' : 'from the start',
          onActivate: () => {
            const at = TASKBAR_ALIGNMENTS.indexOf(settings.taskbarAlignment);
            set({ taskbarAlignment: TASKBAR_ALIGNMENTS[(at + 1) % TASKBAR_ALIGNMENTS.length]! });
          },
          onAdjust: (direction) =>
            set({ taskbarAlignment: shift(TASKBAR_ALIGNMENTS, settings.taskbarAlignment, direction) }),
        },
      ],
    },
    {
      id: 'sound',
      title: 'Sound',
      icon: 'media',
      rows: [
        {
          id: 'soundsEnabled',
          icon: 'media',
          label: 'Interface sounds',
          // There is deliberately no music or wallpaper-audio row: the app has no audio
          // playback beyond these short interface sounds, and a video wallpaper is hard-muted.
          hint: 'Short clicks on focus and activation. Aura Shell plays no music.',
          keywords: 'audio volume mute click',
          value: <Toggle on={settings.soundsEnabled} />,
          onActivate: () => set({ soundsEnabled: !settings.soundsEnabled }),
        },
        {
          id: 'soundVolume',
          icon: 'media',
          label: 'Sound volume',
          hint: 'Left and right to adjust',
          keywords: 'loud quiet audio',
          value: percent(settings.soundVolume),
          onAdjust: (direction) =>
            set({ soundVolume: step(settings.soundVolume, direction, 0, 1, 0.05) }),
        },
      ],
    },
    {
      id: 'shell',
      title: 'Shell',
      icon: 'home',
      rows: [
        {
          id: 'startFullscreen',
          icon: 'home',
          label: 'Fullscreen',
          // Applied at once and remembered: the host acts on a change to `startFullscreen`.
          hint: "Borderless at the display's full resolution. F11 switches it too.",
          keywords: 'window windowed borderless maximised f11 resolution',
          value: <Toggle on={settings.startFullscreen} />,
          onActivate: () => set({ startFullscreen: !settings.startFullscreen }),
        },
        {
          id: 'hideShellOnLaunch',
          icon: 'play',
          label: 'Step aside when a game starts',
          hint: 'Minimise Aura Shell until the game closes',
          keywords: 'minimise background launch',
          value: <Toggle on={settings.hideShellOnLaunch} />,
          onActivate: () => set({ hideShellOnLaunch: !settings.hideShellOnLaunch }),
        },
        {
          id: 'gamepadEnabled',
          icon: 'games',
          label: 'Gamepad',
          keywords: 'controller pad xbox joystick',
          value: <Toggle on={settings.gamepadEnabled} />,
          onActivate: () => set({ gamepadEnabled: !settings.gamepadEnabled }),
        },
        {
          id: 'exitHotkey',
          icon: 'back',
          label: 'Exit hotkey',
          keywords: 'quit close shortcut escape key',
          hint:
            ctx.hotkey && !ctx.hotkey.registered
              ? `Not active${ctx.hotkey.error ? ` - ${ctx.hotkey.error}` : ''}. Activate to try another.`
              : 'Always leaves Aura Shell, even from a game. Activate to change it.',
          value: (
            <kbd data-error={ctx.hotkey && !ctx.hotkey.registered ? true : undefined}>
              {settings.exitHotkey}
            </kbd>
          ),
          onActivate: ctx.cycleExitHotkey,
        },
        {
          id: 'exit',
          icon: 'back',
          label: 'Exit to Windows',
          hint: 'Nothing is changed or removed',
          keywords: 'quit leave close shut down',
          onActivate: ctx.exitShell,
        },
      ],
    },
  ];
}

/** Case-insensitive match over a row's label, hint and keywords. */
export function rowMatches(row: SettingRowSpec, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${row.label} ${row.hint ?? ''} ${row.keywords ?? ''}`.toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** The catalog filtered to a query, with empty categories dropped. */
export function searchCatalog(catalog: SettingsCategory[], query: string): SettingsCategory[] {
  if (query.trim() === '') return catalog;
  return catalog
    .map((category) => ({ ...category, rows: category.rows.filter((r) => rowMatches(r, query)) }))
    .filter((category) => category.rows.length > 0);
}
