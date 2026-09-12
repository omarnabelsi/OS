/**
 * The blur budget: who gets a live `backdrop-filter` when not everyone can.
 *
 * These are the rules the design states, made checkable. The cap is the whole point of the
 * module, so most of this is about what happens at and past it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLUR_BUDGET,
  claim,
  getMode,
  liveBlurCount,
  release,
  resetBudget,
  setMode,
  stateOf,
  subscribe,
} from './budget';

beforeEach(() => {
  resetBudget();
});

describe('the cap', () => {
  it('is three, and holds', () => {
    expect(BLUR_BUDGET).toBe(3);

    claim('taskbar', 'e2', true);
    claim('window-1', 'e3', true);
    claim('overlay', 'e4', true);
    claim('item-1', 'e1', true);

    expect(liveBlurCount()).toBe(3);
    expect(stateOf('item-1')).toBe('off');
  });

  it('cuts the desktop item first, as the design says', () => {
    claim('item-1', 'e1', true);
    claim('item-2', 'e1', true);
    claim('taskbar', 'e2', true);
    claim('window-1', 'e3', true);
    claim('overlay', 'e4', true);

    expect(stateOf('taskbar')).toBe('live');
    expect(stateOf('window-1')).toBe('live');
    expect(stateOf('overlay')).toBe('live');
    expect(stateOf('item-1')).toBe('off');
    expect(stateOf('item-2')).toBe('off');
  });

  it('keeps the taskbar blurred ahead of a window', () => {
    // The taskbar is up the whole time, so losing its blur is the most visible thing that can
    // happen; the design marks it "always on".
    claim('overlay', 'e4', true);
    claim('window-1', 'e3', true);
    claim('window-2', 'e3', true);
    claim('taskbar', 'e2', true);

    expect(stateOf('taskbar')).toBe('live');
    expect(liveBlurCount()).toBe(3);
  });

  it('hands the slot on when a surface goes away', () => {
    claim('taskbar', 'e2', true);
    claim('overlay', 'e4', true);
    claim('window-1', 'e3', true);
    claim('item-1', 'e1', true);
    expect(stateOf('item-1')).toBe('off');

    release('overlay');
    expect(stateOf('item-1')).toBe('live');
  });

  it('settles a tie by who got there first', () => {
    for (let i = 0; i < 5; i++) claim(`item-${i}`, 'e1', true);
    expect(stateOf('item-0')).toBe('live');
    expect(stateOf('item-2')).toBe('live');
    expect(stateOf('item-3')).toBe('off');

    // Re-claiming with the same values must not shuffle the order.
    claim('item-0', 'e1', true);
    expect(stateOf('item-0')).toBe('live');
  });
});

describe('a stack of windows', () => {
  it('produces one blurred window however many are open', () => {
    // The acceptance criterion: opening a third window does not produce a fourth blurred
    // surface. Only the focused window asks - `<Surface blur={focused}>`.
    claim('taskbar', 'e2', true);
    claim('window-1', 'e3', false);
    claim('window-2', 'e3', false);
    claim('window-3', 'e3', true);

    expect(liveBlurCount()).toBe(2);
    expect(stateOf('window-1')).toBe('off');
    expect(stateOf('window-2')).toBe('off');
    expect(stateOf('window-3')).toBe('live');
  });

  it('moves the blur when focus moves', () => {
    claim('window-1', 'e3', true);
    claim('window-2', 'e3', false);
    expect(stateOf('window-1')).toBe('live');

    claim('window-1', 'e3', false);
    claim('window-2', 'e3', true);
    expect(stateOf('window-1')).toBe('off');
    expect(stateOf('window-2')).toBe('live');
    expect(liveBlurCount()).toBe(1);
  });
});

describe('modes', () => {
  it('drops desktop items and nothing else in no-e1', () => {
    claim('item-1', 'e1', true);
    claim('taskbar', 'e2', true);
    setMode('no-e1');

    expect(stateOf('item-1')).toBe('off');
    expect(stateOf('taskbar')).toBe('live');
  });

  it('gives every blurred surface the snapshot instead, in snapshot mode', () => {
    claim('taskbar', 'e2', true);
    claim('window-1', 'e3', false);
    setMode('snapshot');

    expect(liveBlurCount()).toBe(0);
    expect(stateOf('taskbar')).toBe('snapshot');
    // A surface that never wanted blur is flat, not snapshotted.
    expect(stateOf('window-1')).toBe('off');
  });

  it('turns everything flat when blur is off', () => {
    claim('taskbar', 'e2', true);
    claim('overlay', 'e4', true);
    setMode('off');

    expect(liveBlurCount()).toBe(0);
    expect(stateOf('taskbar')).toBe('off');
    expect(stateOf('overlay')).toBe('off');
  });

  it('notifies subscribers when the mode changes even if the grants do not', () => {
    // Going from `full` to `snapshot` with one claim grants nobody either way, but what that
    // surface paints changes completely - so a quiet recompute would leave it stale.
    claim('taskbar', 'e2', false);
    const listener = vi.fn();
    subscribe(listener);

    setMode('snapshot');
    expect(listener).toHaveBeenCalled();
    expect(getMode()).toBe('snapshot');
  });
});

describe('bookkeeping', () => {
  it('ignores a release of something that was never claimed', () => {
    const listener = vi.fn();
    subscribe(listener);
    release('nobody');
    expect(listener).not.toHaveBeenCalled();
  });

  it('reports off for a surface it has never heard of', () => {
    expect(stateOf('nobody')).toBe('off');
  });
});
