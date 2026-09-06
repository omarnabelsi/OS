/**
 * The wallpaper layer, plus the colour bleed from the focused item.
 *
 * The source is the user's `wallpaper` setting, falling back to whatever the theme declares in
 * `layout.json` (`background`, then `fallbackBackground`). Whatever renders, a flat themed colour
 * sits underneath it, so there is never a white flash or a hole if an image or shader fails.
 */

import { useMemo } from 'react';

import type { ThemeLayout, WallpaperSetting } from '@/bridge';
import { assetUrl } from '@/lib/assetUrl';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';

import { ShaderCanvas } from './ShaderCanvas';

/** A theme's `layout.background` is the same shape as a wallpaper setting. */
function themeWallpaper(layout: ThemeLayout | undefined): WallpaperSetting | null {
  const candidate = (layout?.background ?? layout?.fallbackBackground) as
    | WallpaperSetting
    | undefined;
  return candidate?.kind ? candidate : null;
}

/** Resolve `{ kind: 'theme' }` to what the theme actually asks for. */
export function resolveWallpaper(
  setting: WallpaperSetting | undefined,
  layout: ThemeLayout | undefined,
): WallpaperSetting {
  if (!setting || setting.kind === 'theme') {
    return themeWallpaper(layout) ?? { kind: 'color', hex: 'var(--color-background)' };
  }
  return setting;
}

/**
 * Theme asset paths in `layout.json` are relative to the theme folder; artwork and user picks
 * are absolute. Both have to end up as something an <img> can load.
 */
function wallpaperUrl(path: string, assetsDir: string | undefined): string | undefined {
  if (/^(data|blob|https?|asset):/i.test(path) || path.startsWith('/')) return path;
  const base = assetsDir?.replace(/[\\/]assets[\\/]?$/, '');
  return assetUrl(base ? `${base}/${path}` : path);
}

export function Background(): React.JSX.Element {
  const { bundle } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const focusedId = useUiStore((s) => s.focusedItemId);
  const focused = useLibraryStore((s) => (focusedId ? s.byId[focusedId] : undefined));

  const wallpaper = useMemo(
    () => resolveWallpaper(settings?.wallpaper, bundle?.layout),
    [settings?.wallpaper, bundle?.layout],
  );

  const reduceMotion = settings?.reduceMotion ?? false;
  const accent = settings?.accentColor ?? (bundle?.tokens.color?.accent as string | undefined) ?? null;

  // Hero art of the focused item, blurred hard, tints the whole screen towards that game.
  const bleedArt = focused?.artwork.hero ?? focused?.artwork.grid ?? null;

  return (
    <div className="aura-background" aria-hidden="true">
      <div className="aura-background-ground" />

      {wallpaper.kind === 'shader' && bundle?.shaders[wallpaper.id] ? (
        <ShaderCanvas
          source={bundle.shaders[wallpaper.id]!}
          accent={accent}
          paused={reduceMotion}
          className="aura-background-layer"
        />
      ) : null}

      {wallpaper.kind === 'image' ? (
        <img
          className="aura-background-layer aura-background-image"
          src={wallpaperUrl(wallpaper.path, bundle?.assetsDir)}
          alt=""
        />
      ) : null}

      {wallpaper.kind === 'video' ? (
        <video
          className="aura-background-layer aura-background-image"
          src={wallpaperUrl(wallpaper.path, bundle?.assetsDir)}
          autoPlay={!reduceMotion}
          loop
          muted={wallpaper.muted}
          playsInline
        />
      ) : null}

      {wallpaper.kind === 'color' ? (
        <div className="aura-background-layer" style={{ background: wallpaper.hex }} />
      ) : null}

      {bleedArt ? (
        <img className="aura-background-bleed" src={assetUrl(bleedArt)} alt="" key={bleedArt} />
      ) : null}

      <div className="aura-background-scrim" />
    </div>
  );
}
