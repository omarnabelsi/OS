/**
 * Deciding how much blur this machine, this theme and this user are getting.
 *
 * Three inputs, in order of authority:
 *
 *  1. **The theme.** `blur.surface: 0` means the theme is not a glass theme. Nothing overrides
 *     that - a flat theme with a blurred taskbar would just look broken.
 *  2. **The user.** `blurMode` is `off` (never blur), `full` (never degrade) or `auto`.
 *  3. **The frame rate.** Only consulted under `auto`, and only to ask for *less*.
 *
 * The result lands in two places: `budget.setMode`, which the surfaces read, and a
 * `data-surface-blur` attribute on `<html>`, which exists so the state is visible in DevTools and
 * assertable from a test without reaching into module state.
 */

import { useEffect } from 'react';

import { useTheme } from '@/theme';
import { useSettingsStore } from '@/store';
import type { BlurMode } from '@/bridge';

import { setMode, type SurfaceMode } from './budget';
import { isGoodSample, nextMode, startFpsProbe } from './fps';
import { startSnapshotLoop, stopSnapshotLoop } from './snapshot';

export const SURFACE_ATTRIBUTE = 'data-surface-blur';

/**
 * Whether a theme's `blur.surface` token asks for no blur at all.
 *
 * `0`, `'0'` and `'0px'` all mean the same thing to CSS, and a theme author will write whichever
 * one they think of first.
 */
export function blurDisabledByTheme(token: string | number | undefined): boolean {
  if (token === undefined) return false;
  const value = typeof token === 'number' ? token : Number.parseFloat(token);
  return Number.isFinite(value) && value <= 0;
}

/** The mode to start from, before any frames have been counted. */
export function initialMode(setting: BlurMode, themeDisables: boolean): SurfaceMode {
  if (themeDisables || setting === 'off') return 'off';
  return 'full';
}

/**
 * Run the blur controller for the life of the app. Mount once, in the shell.
 *
 * Returns nothing: everything it decides is published through the budget and the document, so no
 * component has to thread the mode down to its surfaces.
 */
export function useSurfaceEngine(): void {
  const { bundle } = useTheme();
  const setting = useSettingsStore((s) => s.settings?.blurMode ?? 'auto');
  const themeDisables = blurDisabledByTheme(bundle?.tokens?.blur?.surface as string | number | undefined);

  useEffect(() => {
    const root = document.documentElement;
    let current = initialMode(setting, themeDisables);
    let goodSamples = 0;
    let stopSnapshot: (() => void) | null = null;

    const apply = (next: SurfaceMode) => {
      current = next;
      setMode(next);
      root.setAttribute(SURFACE_ATTRIBUTE, next);

      // The snapshot costs a repaint twice a second, so it runs only while it is being read.
      if (next === 'snapshot' && !stopSnapshot) stopSnapshot = startSnapshotLoop(root);
      else if (next !== 'snapshot' && stopSnapshot) {
        stopSnapshot();
        stopSnapshot = null;
      }
    };

    apply(current);

    // `off` has nothing to measure, and `full` is the user saying they do not want it measured.
    if (current === 'off' || setting !== 'auto') {
      return () => {
        stopSnapshot?.();
        stopSnapshotLoop(root);
        root.removeAttribute(SURFACE_ATTRIBUTE);
      };
    }

    const probe = startFpsProbe((fps) => {
      goodSamples = isGoodSample(current, fps) ? goodSamples + 1 : 0;
      const next = nextMode(current, fps, goodSamples);
      if (next === current) return;
      goodSamples = 0;
      apply(next);
    });

    return () => {
      probe.stop();
      stopSnapshot?.();
      stopSnapshotLoop(root);
      root.removeAttribute(SURFACE_ATTRIBUTE);
    };
  }, [setting, themeDisables]);
}
