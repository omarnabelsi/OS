/**
 * A frame-rate probe, and the rule that turns frames into a blur mode.
 *
 * The point is not to measure precisely - it is to notice that this machine cannot afford what
 * we are asking of it, and ask for less. An integrated GPU at 4K is the case the design calls
 * out, and there is no way to detect that up front: the same GPU is fine at 1080p.
 */

import type { SurfaceMode } from './budget';

/** How long one sample covers. Long enough to ignore a single slow frame, short enough to react. */
export const SAMPLE_MS = 2000;

/** Below this, desktop items lose their blur. */
export const DEGRADE_FPS = 50;
/** Below this, the whole app moves to the snapshot fallback. */
export const SNAPSHOT_FPS = 40;

/**
 * Recovery thresholds, set clear of the ones above.
 *
 * Without the gap, a machine sitting at 49 fps would drop e1 blur, get a little faster because of
 * it, climb past 50, turn the blur back on, and fall to 49 again - flickering the whole desktop
 * every two seconds. Coming back up also takes two good samples in a row.
 */
export const RECOVER_FULL_FPS = 55;
export const RECOVER_PARTIAL_FPS = 45;
const GOOD_SAMPLES_TO_RECOVER = 2;

/**
 * The next automatic mode, given the last sample.
 *
 * Pure, so the hysteresis is testable without waiting on real frames.
 */
export function nextMode(current: SurfaceMode, fps: number, goodSamples: number): SurfaceMode {
  if (current === 'off') return 'off';

  if (fps < SNAPSHOT_FPS) return 'snapshot';
  if (fps < DEGRADE_FPS) return current === 'snapshot' ? 'snapshot' : 'no-e1';

  const recovered = goodSamples >= GOOD_SAMPLES_TO_RECOVER;
  if (current === 'snapshot') {
    return recovered && fps >= RECOVER_PARTIAL_FPS ? 'no-e1' : 'snapshot';
  }
  if (current === 'no-e1') {
    return recovered && fps >= RECOVER_FULL_FPS ? 'full' : 'no-e1';
  }
  return 'full';
}

/** Whether a sample counts towards recovering a level. */
export function isGoodSample(current: SurfaceMode, fps: number): boolean {
  if (current === 'snapshot') return fps >= RECOVER_PARTIAL_FPS;
  if (current === 'no-e1') return fps >= RECOVER_FULL_FPS;
  return fps >= DEGRADE_FPS;
}

export interface FpsProbe {
  stop(): void;
}

/**
 * Sample the frame rate continuously, calling `onSample` about every `SAMPLE_MS`.
 *
 * The first sample is thrown away. It covers the app starting up - first layout, theme load,
 * font decode, the desktop's first paint - which is always slow and says nothing about what the
 * machine can sustain. Measured, not guessed: without this the shell reliably came up, decided
 * it could not afford desktop-item blur, and spent the next several seconds climbing back.
 *
 * Pauses itself while the document is hidden: a background tab is throttled to a frame a second
 * or so, and reading that as "this machine is slow" would strip the blur off a shell that was
 * merely not being looked at.
 */
export function startFpsProbe(onSample: (fps: number) => void): FpsProbe {
  let frames = 0;
  let windowStart = performance.now();
  let raf = 0;
  let stopped = false;
  let warmedUp = false;

  const reset = () => {
    frames = 0;
    windowStart = performance.now();
  };

  const tick = (now: number) => {
    if (stopped) return;
    frames++;
    const elapsed = now - windowStart;
    if (elapsed >= SAMPLE_MS) {
      if (warmedUp) onSample((frames * 1000) / elapsed);
      warmedUp = true;
      reset();
    }
    raf = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    // Throw away the partial sample either way: it spans the gap.
    reset();
  };

  document.addEventListener('visibilitychange', onVisibility);
  raf = requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
