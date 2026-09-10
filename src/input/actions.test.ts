import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  actionForButton,
  actionForKey,
  axisDirection,
  createRepeater,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  STANDARD_BUTTONS,
  type NavAction,
} from './actions';

describe('actionForKey', () => {
  it('maps arrows and WASD to directions', () => {
    expect(actionForKey({ key: 'ArrowUp' })).toBe('up');
    expect(actionForKey({ key: 'ArrowDown' })).toBe('down');
    expect(actionForKey({ key: 'ArrowLeft' })).toBe('left');
    expect(actionForKey({ key: 'ArrowRight' })).toBe('right');
    expect(actionForKey({ key: 'w' })).toBe('up');
    expect(actionForKey({ key: 'S' })).toBe('down');
    expect(actionForKey({ key: 'a' })).toBe('left');
    expect(actionForKey({ key: 'D' })).toBe('right');
  });

  it('maps activation, back and screen switching', () => {
    expect(actionForKey({ key: 'Enter' })).toBe('activate');
    expect(actionForKey({ key: ' ' })).toBe('activate');
    expect(actionForKey({ key: 'Escape' })).toBe('back');
    expect(actionForKey({ key: 'Backspace' })).toBe('back');
    expect(actionForKey({ key: 'PageDown' })).toBe('nextScreen');
    expect(actionForKey({ key: '[' })).toBe('prevScreen');
    expect(actionForKey({ key: '/' })).toBe('search');
    expect(actionForKey({ key: 'f' })).toBe('favourite');
    expect(actionForKey({ key: 'm' })).toBe('menu');
  });

  it('ignores unbound keys and modified chords', () => {
    expect(actionForKey({ key: 'q' })).toBeNull();
    expect(actionForKey({ key: 'F5' })).toBeNull();
    // Ctrl+W must stay a browser/app shortcut, not "move up".
    expect(actionForKey({ key: 'w', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: 'ArrowUp', altKey: true })).toBeNull();
    expect(actionForKey({ key: 'ArrowUp', metaKey: true })).toBeNull();
  });
});

describe('actionForButton', () => {
  it('uses the console-standard face buttons', () => {
    expect(actionForButton('south')).toBe('activate');
    expect(actionForButton('east')).toBe('back');
    expect(actionForButton('north')).toBe('favourite');
    expect(actionForButton('west')).toBe('menu');
  });

  it('maps the d-pad and shoulders', () => {
    expect(actionForButton('dpad_up')).toBe('up');
    expect(actionForButton('dpad_right')).toBe('right');
    expect(actionForButton('left_shoulder')).toBe('prevScreen');
    expect(actionForButton('right_shoulder')).toBe('nextScreen');
  });

  it('puts window switching on the triggers, clear of the screen shoulders', () => {
    expect(actionForButton('left_trigger')).toBe('prevWindow');
    expect(actionForButton('right_trigger')).toBe('nextWindow');
    expect(actionForButton('left_stick')).toBe('cycleRegion');
  });

  it('leaves the guide button and the right stick unbound', () => {
    expect(actionForButton('guide')).toBeNull();
    expect(actionForButton('right_stick')).toBeNull();
  });
});

describe('window-switching chords', () => {
  it('claims Ctrl+Tab in both directions', () => {
    expect(actionForKey({ key: 'Tab', ctrlKey: true })).toBe('nextWindow');
    expect(actionForKey({ key: 'Tab', ctrlKey: true, shiftKey: true })).toBe('prevWindow');
  });

  it('cycles regions with F6', () => {
    expect(actionForKey({ key: 'F6' })).toBe('cycleRegion');
  });

  it('does not claim Alt+Tab - Windows takes it before we ever see it', () => {
    expect(actionForKey({ key: 'Tab', altKey: true })).toBeNull();
    expect(actionForKey({ key: 'Tab', ctrlKey: true, altKey: true })).toBeNull();
  });

  it('still leaves every other chord alone', () => {
    // The claimed chords are an allow-list, not a hole in the modifier rule.
    expect(actionForKey({ key: 'w', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: 'F6', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: 'Tab', metaKey: true })).toBeNull();
    // A bare Tab is still not a navigation action; the engine suppresses it separately.
    expect(actionForKey({ key: 'Tab' })).toBeNull();
  });
});

describe('STANDARD_BUTTONS', () => {
  it('matches the W3C standard gamepad mapping order', () => {
    expect(STANDARD_BUTTONS[0]).toBe('south');
    expect(STANDARD_BUTTONS[1]).toBe('east');
    expect(STANDARD_BUTTONS[2]).toBe('west');
    expect(STANDARD_BUTTONS[3]).toBe('north');
    expect(STANDARD_BUTTONS[12]).toBe('dpad_up');
    expect(STANDARD_BUTTONS[15]).toBe('dpad_right');
  });
});

describe('axisDirection', () => {
  it('needs a firm push to engage', () => {
    expect(axisDirection(0.2, 'x', null)).toBeNull();
    expect(axisDirection(0.49, 'x', null)).toBeNull();
    expect(axisDirection(0.6, 'x', null)).toBe('right');
    expect(axisDirection(-0.6, 'x', null)).toBe('left');
    expect(axisDirection(-0.9, 'y', null)).toBe('up');
    expect(axisDirection(0.9, 'y', null)).toBe('down');
  });

  it('holds on with a looser threshold so a resting stick does not chatter', () => {
    // Already holding right at 0.4: below the press threshold but above release.
    expect(axisDirection(0.4, 'x', 'right')).toBe('right');
    // Dropped under the release threshold: let go.
    expect(axisDirection(0.3, 'x', 'right')).toBeNull();
  });

  it('does not treat an unrelated held action as hysteresis', () => {
    expect(axisDirection(0.4, 'x', 'up')).toBeNull();
  });
});

describe('createRepeater', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once immediately and then repeats while held', () => {
    const fired: NavAction[] = [];
    const repeater = createRepeater((a) => fired.push(a));

    repeater.press('right');
    expect(fired).toEqual(['right']);

    // Nothing until the initial delay elapses.
    vi.advanceTimersByTime(REPEAT_DELAY_MS - 1);
    expect(fired).toEqual(['right']);

    vi.advanceTimersByTime(1);
    expect(fired).toEqual(['right', 'right']);

    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 3);
    expect(fired).toHaveLength(5);

    repeater.release('right');
    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 5);
    expect(fired).toHaveLength(5);
  });

  it('does not repeat discrete actions', () => {
    const fired: NavAction[] = [];
    const repeater = createRepeater((a) => fired.push(a));

    repeater.press('activate');
    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 10);
    // activate must fire exactly once per press, however long it is held
    expect(fired).toEqual(['activate']);
  });

  it('ignores a repeated press of the key already held', () => {
    const fired: NavAction[] = [];
    const repeater = createRepeater((a) => fired.push(a));

    repeater.press('down');
    repeater.press('down');
    repeater.press('down');
    expect(fired).toEqual(['down']);
  });

  it('switching direction restarts the repeat', () => {
    const fired: NavAction[] = [];
    const repeater = createRepeater((a) => fired.push(a));

    repeater.press('left');
    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS);
    const leftsBefore = fired.filter((a) => a === 'left').length;
    expect(leftsBefore).toBeGreaterThan(1);

    repeater.press('right');
    expect(fired[fired.length - 1]).toBe('right');

    // The old direction's timer must be gone: no further 'left' may appear.
    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 3);
    expect(fired.filter((a) => a === 'left')).toHaveLength(leftsBefore);
  });

  it('releasing a key that is not held does nothing', () => {
    const fired: NavAction[] = [];
    const repeater = createRepeater((a) => fired.push(a));

    repeater.press('up');
    repeater.release('down');
    vi.advanceTimersByTime(REPEAT_DELAY_MS);
    // 'up' must still be repeating: releasing an unrelated key changes nothing
    expect(fired).toEqual(['up', 'up']);

    repeater.stop();
    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 5);
    expect(fired).toHaveLength(2);
  });
});
