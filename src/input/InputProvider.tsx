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
import { toggleShellFullscreen } from '@/store/shellWindow';
import { useWmStore, visibleWindows } from '@/wm';

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
        case 'nextWindow':
        case 'prevWindow': {
          // Explicitly not directional: see the note on `NavAction` and RISKS.md R11.
          const wm = useWmStore.getState();
          if (visibleWindows(wm.windows).length === 0) return;
          play('move');
          // Windows live on the desktop; asking for one from another screen goes there.
          if (screen !== 'home') setScreen('home');
          wm.focusNext(action === 'nextWindow' ? 1 : -1);
          return;
        }
        case 'cycleRegion': {
          // Desktop <-> focused window. The taskbar needs no stop of its own: with no window
          // focused it is back in the pool, one press of Down from the desktop.
          const wm = useWmStore.getState();
          const open = visibleWindows(wm.windows);
          if (open.length === 0) return;
          play('move');
          if (screen !== 'home') {
            // From another screen the useful answer is "show me my window", not "the desktop".
            setScreen('home');
            wm.focus(open[open.length - 1]!.id);
            return;
          }
          if (wm.focusedId) wm.blurAll();
          else wm.focus(open[open.length - 1]!.id);
          return;
        }
        case 'toggleFullscreen':
          // Through the host, which applies it and remembers it - never a direct window call.
          play('select');
          void toggleShellFullscreen();
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
  //
  // The keyboard uses the same repeater as the gamepad rather than the OS's own auto-repeat.
  // Windows repeats a held key every 20-40ms by default, which is a user preference we do not
  // control and is far quicker than a focus move can settle - each move then samples rects
  // mid-scroll and the navigation picks inconsistent neighbours. `createRepeater`'s tested
  // 400ms/110ms cadence gives the keyboard exactly the timing the D-pad already has.
  useEffect(() => {
    const repeat = repeater.current;

    /*
     * What each physical key started, so the matching keyup can release exactly that.
     *
     * Recomputing the action from the keyup event does not work. It cannot use the event's
     * modifiers - they may have been let go first, and a released key must always release its
     * repeat or a held direction runs away - but without them a chord is unrecoverable: `Tab`
     * alone is bound to nothing, so `Ctrl+Tab` would press `nextWindow` and never release it,
     * and the repeater ignores a press for an action it already holds. The second Ctrl+Tab then
     * did nothing at all. Remembering the press is both simpler and exactly right.
     */
    const startedBy = new Map<string, NavAction>();

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      const action = actionForKey(event);
      if (!action) return;
      event.preventDefault();
      // `event.repeat` marks the OS's synthetic repeats. Only the physical press starts ours.
      if (event.repeat) return;
      // A key whose chord changed while it was held (Shift added to Ctrl+Tab, say) must not
      // leave the previous action stuck down.
      const previous = startedBy.get(event.key);
      if (previous && previous !== action) repeat.release(previous);
      startedBy.set(event.key, action);
      repeat.press(action);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const action = startedBy.get(event.key);
      if (!action) return;
      startedBy.delete(event.key);
      repeat.release(action);
    };

    // A key held while the window loses focus never sends its keyup, so stop everything.
    const onBlur = () => {
      startedBy.clear();
      repeat.stop();
    };

    // Tab would move DOM focus out from under the focus engine.
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !isTextEntry(event.target)) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      startedBy.clear();
      repeat.stop();
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
