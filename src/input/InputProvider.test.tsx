/**
 * Keyboard timing. The point of these tests is that the OS's auto-repeat rate - a user setting
 * we do not control, commonly 20-40ms on Windows - never reaches the focus engine: held keys go
 * through the same `createRepeater` cadence the gamepad uses, so a move always finishes before
 * the next one starts.
 */

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the module mock below can close over them whenever it is evaluated.
const { move, activate } = vi.hoisted(() => ({
  move: vi.fn(() => true),
  activate: vi.fn(() => true),
}));

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});

// The focus engine has its own tests; here it only has to record what it was asked to do.
vi.mock('@/focus', () => ({
  useFocus: () => ({ move, activate }),
}));

const { InputProvider } = await import('./InputProvider');
const { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS } = await import('./actions');
const { useWmStore, resetWm } = await import('@/wm');

function keyDown(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
}

function keyUp(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, ...init }));
}

beforeEach(() => {
  vi.useFakeTimers();
  move.mockClear();
  activate.mockClear();
  resetWm();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InputProvider keyboard', () => {
  it('repeats a held direction on its own cadence, not the OS auto-repeat rate', () => {
    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    keyDown('ArrowRight');
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenLastCalledWith('right');

    // What the OS sends while the key is held. Every one of these must be ignored.
    for (let i = 0; i < 20; i++) keyDown('ArrowRight', { repeat: true });
    expect(move).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REPEAT_DELAY_MS - 1);
    expect(move).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(move).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 3);
    expect(move).toHaveBeenCalledTimes(5);

    keyUp('ArrowRight');
    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 10);
    expect(move).toHaveBeenCalledTimes(5);
  });

  it('releases a held key even when the keyup arrives with a modifier down', () => {
    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    keyDown('ArrowRight');
    // Ctrl pressed mid-hold: `actionForKey` refuses modified chords on the way down, but the key
    // still has to let go on the way up or the repeat runs away.
    keyUp('ArrowRight', { ctrlKey: true });

    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 5);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('stops repeating when the window loses focus mid-hold', () => {
    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    keyDown('ArrowDown');
    // No keyup ever arrives in this case - the game that just launched has the keyboard.
    window.dispatchEvent(new Event('blur'));

    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 5);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('activates exactly once however long Enter is held', () => {
    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    keyDown('Enter');
    for (let i = 0; i < 10; i++) keyDown('Enter', { repeat: true });
    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 10);

    expect(activate).toHaveBeenCalledTimes(1);
    expect(move).not.toHaveBeenCalled();
  });

  it('lets a chord be pressed again, having released what the key actually started', () => {
    // The regression: keyup rebuilt the action from `event.key` alone, so `Tab` - bound to
    // nothing on its own - released nothing. `nextWindow` stayed held, and `createRepeater`
    // ignores a press for an action it already holds, so the *second* Ctrl+Tab did nothing.
    const wm = { windows: [], focusNext: vi.fn(), focus: vi.fn(), blurAll: vi.fn(), focusedId: null };
    const open = [
      { id: 'w1', mode: 'normal' },
      { id: 'w2', mode: 'normal' },
    ];
    wm.windows = open as never;

    useWmStore.setState(wm as never);

    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    keyDown('Tab', { ctrlKey: true });
    keyUp('Tab', { ctrlKey: true });
    keyDown('Tab', { ctrlKey: true });
    keyUp('Tab', { ctrlKey: true });

    expect(wm.focusNext).toHaveBeenCalledTimes(2);
    expect(wm.focusNext).toHaveBeenNthCalledWith(1, 1);
    expect(wm.focusNext).toHaveBeenNthCalledWith(2, 1);
  });

  it('releases the previous action when a held key changes chord mid-press', () => {
    const wm = { windows: [], focusNext: vi.fn(), focus: vi.fn(), blurAll: vi.fn(), focusedId: null };
    wm.windows = [{ id: 'w1', mode: 'normal' }] as never;
    useWmStore.setState(wm as never);

    render(
      <InputProvider>
        <span />
      </InputProvider>,
    );

    // Ctrl+Tab, then Shift added without letting Tab go: the browser sends a fresh keydown.
    keyDown('Tab', { ctrlKey: true });
    keyDown('Tab', { ctrlKey: true, shiftKey: true });

    expect(wm.focusNext).toHaveBeenNthCalledWith(1, 1);
    expect(wm.focusNext).toHaveBeenNthCalledWith(2, -1);
  });

  it('leaves the arrow keys to a text field that has focus', () => {
    const { container } = render(
      <InputProvider>
        <input />
      </InputProvider>,
    );
    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(move).not.toHaveBeenCalled();
  });
});
