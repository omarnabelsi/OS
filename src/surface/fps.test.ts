/**
 * The rule that turns a frame rate into a blur mode.
 *
 * The thresholds come from the design (50 fps, 40 fps); the hysteresis does not, and exists
 * because without it a machine sitting just under a threshold flickers the whole desktop every
 * two seconds as the blur is removed, speeds it up, and is put back.
 */

import { describe, expect, it } from 'vitest';

import {
  DEGRADE_FPS,
  RECOVER_FULL_FPS,
  RECOVER_PARTIAL_FPS,
  SNAPSHOT_FPS,
  isGoodSample,
  nextMode,
} from './fps';

describe('nextMode', () => {
  it('drops desktop-item blur below 50 fps', () => {
    expect(nextMode('full', 48, 0)).toBe('no-e1');
    expect(nextMode('full', DEGRADE_FPS, 0)).toBe('full');
  });

  it('falls all the way to the snapshot below 40 fps', () => {
    expect(nextMode('full', 38, 0)).toBe('snapshot');
    expect(nextMode('no-e1', 30, 0)).toBe('snapshot');
    expect(nextMode('full', SNAPSHOT_FPS, 0)).toBe('no-e1');
  });

  it('does not climb back on a single good sample', () => {
    expect(nextMode('no-e1', 60, 0)).toBe('no-e1');
    expect(nextMode('no-e1', 60, 1)).toBe('no-e1');
    expect(nextMode('no-e1', 60, 2)).toBe('full');
  });

  it('needs real headroom to climb, not just the threshold it fell at', () => {
    // 51 fps is above the 50 that cost it the blur, and nowhere near enough to hold it.
    expect(nextMode('no-e1', 51, 5)).toBe('no-e1');
    expect(nextMode('no-e1', RECOVER_FULL_FPS, 5)).toBe('full');
  });

  it('keeps a gap between falling and climbing, in both directions', () => {
    // Without it a machine sitting on a threshold flickers the desktop every two seconds. The
    // gap is also not so wide that a healthy 60 Hz display, which often reports 58, is stuck.
    expect(RECOVER_FULL_FPS).toBeGreaterThan(DEGRADE_FPS);
    expect(RECOVER_FULL_FPS).toBeLessThan(58);
    expect(RECOVER_PARTIAL_FPS).toBeGreaterThan(SNAPSHOT_FPS);
    expect(RECOVER_PARTIAL_FPS).toBeLessThan(DEGRADE_FPS);
  });

  it('climbs out of the snapshot one step at a time', () => {
    expect(nextMode('snapshot', 60, 2)).toBe('no-e1');
    expect(nextMode('snapshot', RECOVER_PARTIAL_FPS - 1, 5)).toBe('snapshot');
  });

  it('never overrides a user who turned blur off', () => {
    expect(nextMode('off', 144, 10)).toBe('off');
    expect(nextMode('off', 5, 0)).toBe('off');
  });
});

describe('isGoodSample', () => {
  it('measures against the bar for getting back up, not the one for falling', () => {
    expect(isGoodSample('no-e1', 51)).toBe(false);
    expect(isGoodSample('no-e1', RECOVER_FULL_FPS)).toBe(true);
    expect(isGoodSample('snapshot', RECOVER_PARTIAL_FPS)).toBe(true);
    expect(isGoodSample('full', 60)).toBe(true);
    expect(isGoodSample('full', 30)).toBe(false);
  });
});
