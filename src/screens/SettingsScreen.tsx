/**
 * Settings. Every control is focusable, so the whole screen is reachable with a D-pad: left and
 * right adjust a value, the activate button toggles it.
 *
 * Writes go through the settings store, which is optimistic and debounced - dragging a slider
 * produces one `update_settings` round-trip, not sixty.
 */

import type { ReactNode } from 'react';

import type { Settings, TileSize } from '@/bridge';
import { Icon, type IconName } from '@/components/Icon';
import { useFocusable } from '@/focus';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';

// ---- focusable controls --------------------------------------------------------------------------

interface RowProps {
  id: string;
  label: string;
  hint?: string;
  value?: ReactNode;
  icon?: IconName;
  onActivate?(): void;
  onAdjust?(direction: -1 | 1): void;
}

function SettingRow({ id, label, hint, value, icon, onActivate, onAdjust }: RowProps): React.JSX.Element {
  const { ref, focused, props } = useFocusable({
    id: `settings:${id}`,
    group: 'content',
    onActivate,
  });

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className="aura-setting"
      role="button"
      {...props}
      onKeyDown={(event) => {
        if (!onAdjust) return;
        if (event.key === 'ArrowLeft') onAdjust(-1);
        if (event.key === 'ArrowRight') onAdjust(1);
      }}
    >
      {icon ? <Icon name={icon} size="1.15em" /> : null}
      <div className="aura-setting-text">
        <span className="aura-setting-label">{label}</span>
        {hint ? <span className="aura-setting-hint">{hint}</span> : null}
      </div>
      <div className="aura-setting-value">
        {onAdjust && focused ? <span className="aura-setting-arrow">‹</span> : null}
        {value}
        {onAdjust && focused ? <span className="aura-setting-arrow">›</span> : null}
      </div>
    </div>
  );
}

function Toggle({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className="aura-toggle" data-on={on || undefined}>
      <span className="aura-toggle-knob" />
    </span>
  );
}

// ---- screen ----------------------------------------------------------------------------------------

const TILE_SIZES: TileSize[] = ['small', 'medium', 'large'];

/** Step a numeric setting and keep it inside its range. */
export function step(value: number, direction: -1 | 1, min: number, max: number, size: number): number {
  const next = Math.round((value + direction * size) * 100) / 100;
  return Math.min(max, Math.max(min, next));
}

export function SettingsScreen(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const settingsError = useSettingsStore((s) => s.error);

  const startScan = useLibraryStore((s) => s.startScan);
  const scan = useLibraryStore((s) => s.scan);
  const itemCount = useLibraryStore((s) => s.items.length);

  const setOverlay = useUiStore((s) => s.setOverlay);
  const pushToast = useUiStore((s) => s.pushToast);
  const { bundle, error: themeError } = useTheme();

  if (!settings) {
    return (
      <div className="aura-screen">
        <h2 className="aura-screen-title">Settings</h2>
        <p className="aura-row-empty">Loading settings…</p>
      </div>
    );
  }

  const set = (patch: Partial<Settings>) => void update(patch);
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="aura-screen aura-settings">
      <h2 className="aura-screen-title">Settings</h2>

      {settingsError ? <p className="aura-error">{settingsError}</p> : null}
      {themeError ? <p className="aura-error">{themeError}</p> : null}

      <section className="aura-setting-group">
        <h3>Library</h3>
        <SettingRow
          id="scan"
          icon="games"
          label="Scan for games"
          hint={scan ? 'Scanning…' : `${itemCount} items in your library`}
          value={<Icon name="play" size="0.9em" />}
          onActivate={() => {
            pushToast('info', 'Scanning your stores');
            void startScan();
          }}
        />
        <SettingRow
          id="add"
          icon="plus"
          label="Add a program"
          hint="Point Aura Shell at any .exe or shortcut"
          onActivate={() => setOverlay('addEntry')}
        />
        <SettingRow
          id="scanOnStartup"
          icon="settings"
          label="Scan on startup"
          hint="Refresh the library each time Aura Shell opens"
          value={<Toggle on={settings.scanOnStartup} />}
          onActivate={() => set({ scanOnStartup: !settings.scanOnStartup })}
        />
      </section>

      <section className="aura-setting-group">
        <h3>Appearance</h3>
        <SettingRow
          id="theme"
          icon="apps"
          label="Theme"
          hint={bundle?.info.author ? `by ${bundle.info.author}` : undefined}
          value={bundle?.info.name ?? settings.themeId}
        />
        <SettingRow
          id="tileSize"
          icon="apps"
          label="Tile size"
          value={settings.tileSize}
          onAdjust={(direction) => {
            const index = TILE_SIZES.indexOf(settings.tileSize);
            const next = TILE_SIZES[Math.min(TILE_SIZES.length - 1, Math.max(0, index + direction))];
            if (next) set({ tileSize: next });
          }}
          onActivate={() => {
            const index = TILE_SIZES.indexOf(settings.tileSize);
            set({ tileSize: TILE_SIZES[(index + 1) % TILE_SIZES.length]! });
          }}
        />
        <SettingRow
          id="uiScale"
          icon="settings"
          label="Interface scale"
          hint="Left and right to adjust"
          value={percent(settings.uiScale)}
          onAdjust={(direction) => set({ uiScale: step(settings.uiScale, direction, 0.5, 2, 0.05) })}
        />
        <SettingRow
          id="reduceMotion"
          icon="media"
          label="Reduce motion"
          hint="Turn off animation and pause animated wallpapers"
          value={<Toggle on={settings.reduceMotion} />}
          onActivate={() => set({ reduceMotion: !settings.reduceMotion })}
        />
      </section>

      <section className="aura-setting-group">
        <h3>Sound</h3>
        <SettingRow
          id="soundsEnabled"
          icon="media"
          label="Interface sounds"
          value={<Toggle on={settings.soundsEnabled} />}
          onActivate={() => set({ soundsEnabled: !settings.soundsEnabled })}
        />
        <SettingRow
          id="soundVolume"
          icon="media"
          label="Sound volume"
          hint="Left and right to adjust"
          value={percent(settings.soundVolume)}
          onAdjust={(direction) =>
            set({ soundVolume: step(settings.soundVolume, direction, 0, 1, 0.05) })
          }
        />
        <SettingRow
          id="musicVolume"
          icon="media"
          label="Wallpaper volume"
          hint="Audio from a video wallpaper"
          value={percent(settings.musicVolume)}
          onAdjust={(direction) =>
            set({ musicVolume: step(settings.musicVolume, direction, 0, 1, 0.05) })
          }
        />
      </section>

      <section className="aura-setting-group">
        <h3>Shell</h3>
        <SettingRow
          id="startFullscreen"
          icon="home"
          label="Start fullscreen"
          value={<Toggle on={settings.startFullscreen} />}
          onActivate={() => set({ startFullscreen: !settings.startFullscreen })}
        />
        <SettingRow
          id="hideShellOnLaunch"
          icon="play"
          label="Step aside when a game starts"
          hint="Minimise Aura Shell until the game closes"
          value={<Toggle on={settings.hideShellOnLaunch} />}
          onActivate={() => set({ hideShellOnLaunch: !settings.hideShellOnLaunch })}
        />
        <SettingRow
          id="gamepadEnabled"
          icon="games"
          label="Gamepad"
          value={<Toggle on={settings.gamepadEnabled} />}
          onActivate={() => set({ gamepadEnabled: !settings.gamepadEnabled })}
        />
        <SettingRow
          id="exitHotkey"
          icon="back"
          label="Exit hotkey"
          hint="Always leaves Aura Shell, even from a game"
          value={<kbd>{settings.exitHotkey}</kbd>}
        />
        <SettingRow
          id="exit"
          icon="back"
          label="Exit to Windows"
          hint="Nothing is changed or removed"
          onActivate={() => setOverlay('exit')}
        />
      </section>
    </div>
  );
}
