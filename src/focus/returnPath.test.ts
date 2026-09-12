/**
 * The return path: the opposite press retraces a move that left its group.
 *
 * The case that motivated it, measured in the running shell at 1080p: Down from the bottom folder
 * reached the taskbar's Home button, and Up from there went to the nav bar's "Settings", skipping
 * every folder. Nothing below should let that come back.
 */

import { describe, expect, it } from 'vitest';

import { recordPath, returnTarget } from './returnPath';

describe('the return path', () => {
  it('sends Up back to the folder that Down left, instead of the nav bar above the taskbar', () => {
    const path = recordPath('desktop:favourites', 'desktop', 'taskbar:launcher', 'taskbar', 'down');
    expect(returnTarget(path, 'taskbar:launcher', 'up')).toBe('desktop:favourites');
  });

  it('works for every axis', () => {
    const left = recordPath('window:1:close', 'window:1', 'desktop:games', 'desktop', 'left');
    expect(returnTarget(left, 'desktop:games', 'right')).toBe('window:1:close');

    const up = recordPath('desktop:games', 'desktop', 'nav:home', 'nav', 'up');
    expect(returnTarget(up, 'nav:home', 'down')).toBe('desktop:games');
  });

  it('does not fire for any direction but the opposite one', () => {
    const path = recordPath('desktop:favourites', 'desktop', 'taskbar:launcher', 'taskbar', 'down');
    expect(returnTarget(path, 'taskbar:launcher', 'down')).toBeNull();
    expect(returnTarget(path, 'taskbar:launcher', 'left')).toBeNull();
    expect(returnTarget(path, 'taskbar:launcher', 'right')).toBeNull();
  });

  it('is forgotten once focus has moved on from where the crossing landed', () => {
    // Along the taskbar to another button, or a click elsewhere: "back" no longer means anything.
    const path = recordPath('desktop:favourites', 'desktop', 'taskbar:launcher', 'taskbar', 'down');
    expect(returnTarget(path, 'taskbar:pin-1', 'up')).toBeNull();
    expect(returnTarget(path, null, 'up')).toBeNull();
  });

  it('records nothing for a move inside one group, where the geometry already agrees with itself', () => {
    expect(recordPath('desktop:games', 'desktop', 'desktop:apps', 'desktop', 'down')).toBeNull();
    expect(returnTarget(null, 'desktop:apps', 'up')).toBeNull();
  });

  it('treats an ungrouped focusable as its own group', () => {
    expect(recordPath('a', undefined, 'b', 'nav', 'up')).toEqual({ from: 'a', to: 'b', direction: 'up' });
    expect(recordPath('a', undefined, 'b', undefined, 'up')).toBeNull();
  });
});
