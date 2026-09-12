/**
 * The wallpaper layer, plus the colour bleed from the focused item.
 *
 * The source is the user's `wallpaper` setting, falling back to whatever the theme declares in
 * `layout.json` (`background`, then `fallbackBackground`), and finally to the shell's own aurora
 * field. The field is always painted underneath whatever else renders, so a shader that fails to
 * compile or an image that fails to load leaves the designed background rather than a hole.
 *
 * `aura-default` declares no wallpaper at all any more: the field *is* its background. The
 * shaders are still shipped and still render when something asks for one by name.
 *
 * A video wallpaper is always silent. This is the only element in the app that could carry an
 * audio track, and Aura Shell plays no music - so the mute is hard-coded here rather than
 * configurable, and `useSilentVideo` holds it there.
 */

import { useCallback, useMemo } from 'react';

import type { ThemeLayout, WallpaperSetting } from '@/bridge';
import { assetUrl } from '@/lib/assetUrl';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';

import { AuroraField } from './AuroraField';
import { ShaderCanvas } from './ShaderCanvas';

/**
 * What the background actually draws.
 *
 * `field` is the shell's own aurora field and is not a `WallpaperSetting`: nothing stores it and
 * nobody picks it. It is simply what is there when neither the user nor the theme has asked for
 * anything else - which makes it the default, and the fallback when a shader or image is gone.
 */
export type BackgroundSource = WallpaperSetting | { kind: 'field' };

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
): BackgroundSource {
  if (!setting || setting.kind === 'theme') {
    return themeWallpaper(layout) ?? { kind: 'field' };
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

/**
 * Pins a video wallpaper silent, and keeps it that way.
 *
 * The `muted` attribute alone is the contract, but it is one property assignment away from being
 * undone, and a wallpaper is the only element in the app that could ever carry an audio track. So
 * the volume is zeroed too and both are re-applied if anything ever changes them - the app has no
 * music playback, and a video wallpaper must not become a loophole for one.
 */
function useSilentVideo(): (element: HTMLVideoElement | null) => (() => void) | undefined {
  return useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    const silence = () => {
      element.muted = true;
      element.volume = 0;
    };
    // Setting a value it already holds fires nothing, so this settles rather than looping.
    silence();
    element.addEventListener('volumechange', silence);
    element.addEventListener('loadedmetadata', silence);
    return () => {
      element.removeEventListener('volumechange', silence);
      element.removeEventListener('loadedmetadata', silence);
    };
  }, []);
}

export function Background(): React.JSX.Element {
  const { bundle } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const focusedId = useUiStore((s) => s.focusedItemId);
  const focused = useLibraryStore((s) => (focusedId ? s.byId[focusedId] : undefined));
  const silenceVideo = useSilentVideo();

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
      {/*
        The field is the ground, always painted. A wallpaper the user or theme chose renders over
        it, so a shader that fails to compile or an image that fails to load leaves the designed
        background rather than a flat colour - or a hole.
      */}
      <AuroraField />

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
          ref={silenceVideo}
          className="aura-background-layer aura-background-image"
          src={wallpaperUrl(wallpaper.path, bundle?.assetsDir)}
          autoPlay={!reduceMotion}
          loop
          // Never configurable. A wallpaper is a moving picture; the app plays no music.
          muted
          playsInline
        />
      ) : null}

      {wallpaper.kind === 'color' ? (
        <div className="aura-background-layer" style={{ background: wallpaper.hex }} />
      ) : null}

      {bleedArt ? (
        <img className="aura-background-bleed" src={assetUrl(bleedArt)} alt="" key={bleedArt} />
      ) : null}

      {/*
        Only over a wallpaper. The field draws its own vignette, under the wallpaper layers where
        it cannot darken an image - so with both, the top and bottom of the screen were dimmed
        twice and the aurora was crushed to near-black.
      */}
      {wallpaper.kind !== 'field' ? <div className="aura-background-scrim" /> : null}
    </div>
  );
}
