/**
 * Turns raw input into navigation actions and applies them to the focus engine.
 *
 * Two gamepad paths, deliberately exclusive:
 *  - Inside Tauri the native gilrs service is authoritative (`input://gamepad`). It sees pads the
 *    webview may not, and keeps working when the window is not focused.
 *  - In a browser we poll the Gamepad API instead.
 * Running both at once would double every press, so `isTauri()` picks exactly one.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { isTauri, onCoreEvent } from '@/bridge';
import type { GamepadButton } from '@/bridge';
import { useFocus } from '@/focus';
import { useSound } from '@/sound';
import { useUiStore } from '@/store';

import {
  actionForButton,
  actionForKey,
  axisDirection,
  createRepeater,
  STANDARD_BUTTONS,
  type NavAction,
} from './actions';

/** True when the user is typing, so navigation keys must be left alone. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function InputProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { move, activate } = useFocus();
  const play = useSound();

  const overlay = useUiStore((s) => s.overlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const nextScreen = useUiStore((s) => s.nextScreen);
  const prevScreen = useUiStore((s) => s.prevScreen);
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);

  // The dispatcher is rebuilt when its dependencies change; input sources read it through a ref
  // so their listeners and rAF loop are installed exactly once.
  const dispatch = useCallback(
    (action: NavAction) => {
      switch (action) {
        case 'up':
        case 'down':
        case 'left':
        case 'right': {
          if (move(action)) play('move');
          return;
        }
        case 'activate':
          if (activate()) play('select');
          return;
        case 'back': {
          play('back');
          if (overlay !== null) setOverlay(null);
          else if (screen !== 'home') setScreen('home');
          else setOverlay('exit');
          return;
        }
        case 'nextScreen':
          if (overlay !== null) return;
          play('move');
          nextScreen();
          return;
        case 'prevScreen':
          if (overlay !== null) return;
          play('move');
          prevScreen();
          return;
        case 'menu':
          if (overlay === null) {
            play('select');
            setOverlay('itemMenu');
          }
          return;
        case 'favourite':
        case 'search':
          // Handled by the focused screen through its own key handling in V1.
          return;
      }
    },
    [move, activate, play, overlay, setOverlay, screen, setScreen, nextScreen, prevScreen],
  );

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const repeater = useRef(createRepeater((action) => dispatchRef.current(action)));

  // ---- keyboard -------------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      const action = actionForKey(event);
      if (!action) return;
      event.preventDefault();
      // The browser already auto-repeats held keys, so this bypasses our own repeater.
      dispatchRef.current(action);
    };

    // Tab would move DOM focus out from under the focus engine.
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !isTextEntry(event.target)) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, []);

  // ---- gamepad: native events (inside Tauri) --------------------------------------------------
  useEffect(() => {
    if (!isTauri()) return;
    const held = { x: null as NavAction | null, y: null as NavAction | null };
    const repeat = repeater.current;

    const unsubscribe = onCoreEvent('input://gamepad', (event) => {
      if (event.kind === 'button' && event.button) {
        const action = actionForButton(event.button);
        if (!action) return;
        if (event.pressed) repeat.press(action);
        else repeat.release(action);
        return;
      }

      if (event.kind === 'axis' && event.axis) {
        const axis = event.axis === 'left_x' || event.axis === 'right_x' ? 'x' : 'y';
        const previous = held[axis];
        const next = axisDirection(event.value, axis, previous);
        if (next === previous) return;
        if (previous) repeat.release(previous);
        if (next) repeat.press(next);
        held[axis] = next;
      }
    });

    return () => {
      unsubscribe();
      repeat.stop();
    };
  }, []);

  // ---- gamepad: browser polling (outside Tauri) -----------------------------------------------
  useEffect(() => {
    if (isTauri()) return;
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;

    const repeat = repeater.current;
    const pressed = new Set<GamepadButton>();
    const held = { x: null as NavAction | null, y: null as NavAction | null };
    let frame = 0;

    const poll = () => {
      frame = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p) => p && p.connected);
      if (!pad) return;

      pad.buttons.forEach((button, index) => {
        const name = STANDARD_BUTTONS[index];
        if (!name) return;
        const isDown = button.pressed || button.value > 0.5;
        const wasDown = pressed.has(name);
        if (isDown === wasDown) return;

        if (isDown) pressed.add(name);
        else pressed.delete(name);

        const action = actionForButton(name);
        if (!action) return;
        if (isDown) repeat.press(action);
        else repeat.release(action);
      });

      // Left stick only; the right stick is unbound in V1.
      for (const [axis, index] of [
        ['x', 0],
        ['y', 1],
      ] as const) {
        const value = pad.axes[index] ?? 0;
        const previous = held[axis];
        const next = axisDirection(value, axis, previous);
        if (next === previous) continue;
        if (previous) repeat.release(previous);
        if (next) repeat.press(next);
        held[axis] = next;
      }
    };

    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      repeat.stop();
    };
  }, []);

  return <>{children}</>;
}
