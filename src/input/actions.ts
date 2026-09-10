/**
 * Input mapping: keyboard keys and gamepad buttons in, navigation actions out.
 *
 * Pure and side-effect free so the bindings can be tested without a DOM or a controller, and so
 * a future "remap controls" screen has one obvious place to write to.
 */

import type { GamepadButton } from '@/bridge';

export type NavAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back'
  | 'nextScreen'
  | 'prevScreen'
  | 'menu'
  | 'search'
  | 'favourite'
  /**
   * Move focus *between* windows.
   *
   * Deliberately its own action rather than something directional movement does. The focus
   * engine is spatial, and a tile in a background window is geometrically "to the right of" one
   * in the foreground; asking `right` to sometimes leave the window cannot be made predictable.
   * See docs/RISKS.md R11.
   */
  | 'nextWindow'
  | 'prevWindow'
  /** Hop between the desktop and the focused window (and, from phase 5, the taskbar). */
  | 'cycleRegion';

/** Directions auto-repeat when held; discrete actions fire once per press. */
export const REPEATABLE: ReadonlySet<NavAction> = new Set<NavAction>(['up', 'down', 'left', 'right']);

/** Hold this long before the first repeat, then repeat this often. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_INTERVAL_MS = 110;

/** Push past this to register a stick direction... */
export const AXIS_PRESS = 0.5;
/** ...and fall back under this to release it. The gap stops a resting stick chattering. */
export const AXIS_RELEASE = 0.35;

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function actionForKey(event: KeyLike): NavAction | null {
  /*
   * The only chords the shell claims.
   *
   * Not `Alt+Tab`: Windows takes that before any application sees it, and a borderless
   * fullscreen shell is no exception. `Ctrl+Tab` is the same gesture that switches tabs
   * everywhere else, so it is the closest thing to muscle memory available. `F6` cycles panes,
   * matching the Windows convention.
   */
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Tab') {
    return event.shiftKey ? 'prevWindow' : 'nextWindow';
  }
  if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'F6') {
    return 'cycleRegion';
  }

  // Every other modified chord stays with the OS or the browser.
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
      return 'activate';
    case 'Escape':
    case 'Backspace':
      return 'back';
    case 'PageDown':
    case ']':
      return 'nextScreen';
    case 'PageUp':
    case '[':
      return 'prevScreen';
    case '/':
      return 'search';
    default:
      break;
  }

  // Single letters, case-insensitively.
  switch (event.key.toLowerCase()) {
    case 'w':
      return 'up';
    case 's':
      return 'down';
    case 'a':
      return 'left';
    case 'd':
      return 'right';
    case 'f':
      return 'favourite';
    case 'm':
      return 'menu';
    default:
      return null;
  }
}

export function actionForButton(button: GamepadButton): NavAction | null {
  switch (button) {
    case 'dpad_up':
      return 'up';
    case 'dpad_down':
      return 'down';
    case 'dpad_left':
      return 'left';
    case 'dpad_right':
      return 'right';
    case 'south':
      return 'activate';
    case 'east':
      return 'back';
    case 'north':
      return 'favourite';
    case 'west':
      return 'menu';
    case 'left_shoulder':
      return 'prevScreen';
    case 'right_shoulder':
      return 'nextScreen';
    // The triggers take window switching: the shoulders already move between screens, and
    // stacking both on one pair of buttons would be unreadable.
    case 'left_trigger':
      return 'prevWindow';
    case 'right_trigger':
      return 'nextWindow';
    // Left stick click hops between the desktop and the focused window.
    case 'left_stick':
      return 'cycleRegion';
    case 'select':
      return 'search';
    case 'start':
      return 'menu';
    default:
      // The guide button and the right stick stay unbound.
      return null;
  }
}

/**
 * Standard-mapping button index -> our button name, for the browser Gamepad API.
 * https://w3c.github.io/gamepad/#remapping
 */
export const STANDARD_BUTTONS: ReadonlyArray<GamepadButton | null> = [
  'south',
  'east',
  'west',
  'north',
  'left_shoulder',
  'right_shoulder',
  'left_trigger',
  'right_trigger',
  'select',
  'start',
  'left_stick',
  'right_stick',
  'dpad_up',
  'dpad_down',
  'dpad_left',
  'dpad_right',
  'guide',
];

/**
 * Repeat state machine shared by every input source: whichever source presses first owns the
 * repeat until it releases, so a stick and a D-pad held together do not double-fire.
 */
export interface Repeater {
  press(action: NavAction): void;
  release(action: NavAction): void;
  stop(): void;
}

export function createRepeater(
  dispatch: (action: NavAction) => void,
  delayMs: number = REPEAT_DELAY_MS,
  intervalMs: number = REPEAT_INTERVAL_MS,
): Repeater {
  let held: NavAction | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    press(action) {
      if (held === action) return; // already held: the timer is running
      clear();
      held = action;
      dispatch(action);
      if (!REPEATABLE.has(action)) return;

      const tick = () => {
        dispatch(action);
        timer = setTimeout(tick, intervalMs);
      };
      timer = setTimeout(tick, delayMs);
    },
    release(action) {
      if (held !== action) return;
      clear();
      held = null;
    },
    stop() {
      clear();
      held = null;
    },
  };
}

/** Stick position -> a direction, with separate press/release thresholds (hysteresis). */
export function axisDirection(
  value: number,
  axis: 'x' | 'y',
  currentlyHeld: NavAction | null,
): NavAction | null {
  const negative: NavAction = axis === 'x' ? 'left' : 'up';
  const positive: NavAction = axis === 'x' ? 'right' : 'down';
  const isHeld = currentlyHeld === negative || currentlyHeld === positive;
  const threshold = isHeld ? AXIS_RELEASE : AXIS_PRESS;

  if (value <= -threshold) return negative;
  if (value >= threshold) return positive;
  return null;
}
