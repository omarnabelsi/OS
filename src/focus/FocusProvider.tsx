/**
 * The focus engine. One provider owns "what is focused right now"; every focusable element
 * registers its DOM node and gets back a `focused` flag.
 *
 * Rects are read live from the DOM at the moment of a move rather than cached, because tile rows
 * scroll and the layout reflows on resize - a cached rect is wrong within one frame of any of
 * that. Reading ~50 rects on a key press is well inside the frame budget.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  firstInReadingOrder,
  nearestTo,
  pickInDirection,
  type Candidate,
  type Direction,
  type Rect,
} from './geometry';
import { recordPath, returnTarget, type ReturnPath } from './returnPath';

export interface FocusableOptions {
  id: string;
  /** Focusables are matched within a group when a move is scoped to one (e.g. an overlay). */
  group?: string;
  onActivate?: () => void;
  onFocus?: () => void;
  /** Skip this element when moving (still registered, e.g. a disabled button). */
  disabled?: boolean;
}

interface FocusEntry extends FocusableOptions {
  element: HTMLElement;
}

/**
 * What put focus where it is.
 *
 * - `nav`     - the D-pad, the keyboard, or code moving focus on the user's behalf.
 * - `pointer` - the mouse hovering or clicking.
 * - `auto`    - the engine itself: the first placement of a session, or re-homing focus after a
 *               surface appeared or the focused entry went away.
 *
 * This is `:focus-visible`'s distinction. Mouse and pad share one focus, which keeps the hero panel
 * and the colour bleed describing the same item however the user drives - but *showing* focus is
 * a separate question. A ring is how a pad user knows where they are; a mouse user already knows,
 * and for them the same ring turned every hover into a focus, so a design's separate hover state
 * could never be seen. And a placement nobody asked for should show nothing at all.
 */
export type FocusSource = 'nav' | 'pointer' | 'auto';

export interface FocusContextValue {
  focusedId: string | null;
  /** What placed the current focus - see `FocusSource`. */
  focusSource: FocusSource;
  /** The group moves are currently confined to. `null` means the whole screen. */
  scope: string | null;
  setScope(group: string | null): void;
  register(entry: FocusEntry): () => void;
  /**
   * True once the pointer has genuinely moved.
   *
   * The shell opens fullscreen underneath wherever the cursor already was, and Chromium fires
   * `mouseenter` for whatever element lands beneath it - which would move focus, and scroll the
   * page to it, without the user having done anything. Requiring one real movement first makes
   * hover mean hover.
   */
  pointerHasMoved(): boolean;
  /** Focus an entry. Defaults to `nav`: code moving focus is doing it for the user. */
  focus(id: string, source?: FocusSource): void;
  focusFirst(group?: string): boolean;
  move(direction: Direction): boolean;
  activate(): boolean;
}

const FocusContext = createContext<FocusContextValue | null>(null);

/**
 * Groups that are shell chrome rather than a surface the user came to use.
 *
 * The engine parks focus here for a frame during a screen change, because for that frame the nav
 * bar is all that is registered - and it must move off again as soon as real content appears.
 * This used to be spelled `group !== 'content'`, which silently stopped working the moment a
 * second primary group existed (`desktop`, and shortly `taskbar` and `window:*`).
 *
 * The taskbar is chrome too. It sits at the bottom, so reading order rarely picks it first -
 * but on a desktop with no icons it is the only thing registered, and the first focus of the
 * session must not park on it and stay there once a surface appears.
 */
// The shell's title bar (windowed only) is chrome too: reachable with Up from the nav bar,
// never where the first focus of a session lands.
const CHROME_GROUPS: ReadonlySet<string> = new Set(['nav', 'taskbar', 'titlebar']);

const isChrome = (group: string | undefined): boolean => group !== undefined && CHROME_GROUPS.has(group);

/**
 * Groups whose focus stays quiet until the user asks for it.
 *
 * The desktop is a composition first and a list second: at rest every folder sits at full opacity
 * with no ring, and the engine's own first placement must not light one up and dim the rest. The
 * first press of a direction there *reveals* where focus already is rather than moving it, so a
 * pad user sees the folder they are on before they leave it.
 *
 * Other surfaces keep their automatic focus visible and moving on the first press: the Games
 * screen's hero panel is driven by it, and a first press that did nothing there would read as a
 * dropped input.
 */
const QUIET_GROUPS: ReadonlySet<string> = new Set(['desktop']);

/**
 * Keeps the focused tile on screen.
 *
 * `behavior: 'auto'`, not `'smooth'`: `move()` measures live rects, and a smooth scroll is still
 * animating 300ms later, so a held direction key samples positions mid-flight and the geometry
 * picks inconsistent neighbours - "it jumped to the middle of the row". Scrolling instantly
 * makes every measurement describe where things actually are. The tile's own spring is harmless
 * by comparison: it scales about the centre, and the geometry costs are centre-based.
 */
function revealElement(element: HTMLElement): void {
  element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
}

export function FocusProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const entries = useRef(new Map<string, FocusEntry>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusSource, setFocusSource] = useState<FocusSource>('auto');
  const [scope, setScope] = useState<string | null>(null);
  // Bumped whenever the registry changes, so the auto-focus effect re-runs.
  const [registryVersion, setRegistryVersion] = useState(0);

  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  const focusSourceRef = useRef<FocusSource>('auto');
  focusSourceRef.current = focusSource;
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;

  const register = useCallback((entry: FocusEntry) => {
    entries.current.set(entry.id, entry);
    setRegistryVersion((v) => v + 1);
    return () => {
      entries.current.delete(entry.id);
      setRegistryVersion((v) => v + 1);
    };
  }, []);

  /** Live rects for everything eligible to receive focus right now. */
  const candidates = useCallback((): Candidate[] => {
    const activeScope = scopeRef.current;
    const out: Candidate[] = [];
    for (const entry of entries.current.values()) {
      if (entry.disabled) continue;
      if (activeScope !== null && entry.group !== activeScope) continue;
      if (!entry.element.isConnected) continue;
      const rect = entry.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      out.push({ id: entry.id, rect });
    }
    return out;
  }, []);

  /**
   * True while the current focus was chosen by the engine rather than by the user.
   *
   * This matters on every screen change: the outgoing screen unmounts before the incoming one
   * mounts, so for a frame the only focusables are the nav bar and focus is parked there. An
   * auto-placed focus is allowed to re-home onto content the moment content appears; a focus the
   * user put on the nav bar themselves is left exactly where they put it.
   */
  const autoPlacedRef = useRef(true);

  /**
   * Where focus was the last time it landed, recorded rather than read on demand.
   *
   * An entry that has left the registry has no element left to measure, and that is precisely
   * when the recovery below needs a rect: without one it falls back to the first tile in reading
   * order, which is the "it slid back to the first game" report.
   */
  const lastRectRef = useRef<Rect | null>(null);

  /**
   * False until the user actually drives focus (a key, the stick, the mouse).
   *
   * Startup places focus at least twice on its own: onto the nav bar, because for a frame that
   * is all that is registered, then onto the first tile once content mounts. Neither follows an
   * input, and scrolling for either drags the page before the user has asked for anything - on
   * Home that pulled the rows up over the hero on first paint. Gating on real interaction
   * rather than on "is this the first placement" covers the whole settling sequence, however
   * many placements it takes.
   *
   * Recovery after an entry disappears mid-navigation still scrolls, because by then the user
   * has navigated and the newly chosen tile does need to be brought on screen.
   */
  const userHasNavigatedRef = useRef(false);

  // See `pointerHasMoved` on the context type.
  const pointerMovedRef = useRef(false);
  useEffect(() => {
    const onMove = () => {
      pointerMovedRef.current = true;
    };
    window.addEventListener('pointermove', onMove, { once: true, passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const pointerHasMoved = useCallback(() => pointerMovedRef.current, []);

  const applyFocus = useCallback((id: string, source: FocusSource = 'auto') => {
    const entry = entries.current.get(id);
    if (!entry) return;
    autoPlacedRef.current = true;
    // The ref as well as the state, so a second call inside the same event already sees it.
    focusSourceRef.current = source;
    setFocusSource(source);
    setFocusedId(id);
    entry.onFocus?.();

    if (userHasNavigatedRef.current) revealElement(entry.element);

    // After any reveal, so the remembered rect is where the element ended up on screen.
    lastRectRef.current = entry.element.getBoundingClientRect();
  }, []);

  /**
   * Focus something because the user asked: a move, a hover, a click.
   *
   * This is the only entry point that counts as interaction, which is what unlocks scrolling
   * (see `userHasNavigatedRef`). Engine-driven placement goes through `applyFocus` directly.
   */
  const focus = useCallback(
    (id: string, source: FocusSource = 'nav') => {
      userHasNavigatedRef.current = true;
      applyFocus(id, source);
      autoPlacedRef.current = false;
    },
    [applyFocus],
  );

  const focusFirst = useCallback(
    (group?: string) => {
      const pool = group
        ? candidates().filter((c) => entries.current.get(c.id)?.group === group)
        : candidates();
      const first = firstInReadingOrder(pool);
      if (!first) return false;
      focus(first.id);
      return true;
    },
    [candidates, focus],
  );

  /**
   * The last move that crossed from one group into another - see `returnPath.ts`.
   *
   * Without it Up from the taskbar picked whatever was aligned above the taskbar button, which on
   * the desktop is the nav bar, and every folder was skipped on the way.
   */
  const returnPathRef = useRef<ReturnPath | null>(null);

  const move = useCallback(
    (direction: Direction) => {
      const pool = candidates();
      if (pool.length === 0) return false;

      const currentId = focusedIdRef.current;
      const current = currentId ? entries.current.get(currentId) : undefined;
      if (!current || !current.element.isConnected) {
        // Nothing focused (or it vanished): take the first thing rather than doing nothing.
        const first = firstInReadingOrder(pool);
        if (!first) return false;
        returnPathRef.current = null;
        focus(first.id);
        return true;
      }

      // On a quiet surface, a focus the user has not seen yet is shown by the first press rather
      // than moved away from - see `QUIET_GROUPS`.
      if (
        focusSourceRef.current !== 'nav' &&
        current.group !== undefined &&
        QUIET_GROUPS.has(current.group)
      ) {
        focus(current.id);
        return true;
      }

      // The opposite press retraces a group crossing - but only to somewhere still reachable:
      // an origin that has unmounted, or sits outside the current scope, falls back to geometry.
      const back = returnTarget(returnPathRef.current, currentId, direction);
      if (back && pool.some((c) => c.id === back)) {
        returnPathRef.current = null;
        focus(back);
        return true;
      }

      const fromRect = current.element.getBoundingClientRect();
      const next = pickInDirection(
        fromRect,
        pool.filter((c) => c.id !== currentId),
        direction,
      );
      if (!next) {
        // Nowhere to go - but if the user cannot see where focus is (the pointer or the engine put
        // it there), the press should at least show them. Picking up the pad with the cursor
        // resting on the taskbar and pressing Down used to do nothing at all, visibly or not.
        if (focusSourceRef.current !== 'nav') {
          focus(current.id);
          return true;
        }
        return false;
      }
      returnPathRef.current = recordPath(
        current.id,
        current.group,
        next.id,
        entries.current.get(next.id)?.group,
        direction,
      );
      focus(next.id);
      return true;
    },
    [candidates, focus],
  );

  const activate = useCallback(() => {
    const currentId = focusedIdRef.current;
    if (!currentId) return false;
    const entry = entries.current.get(currentId);
    if (!entry || entry.disabled) return false;
    entry.onActivate?.();
    return true;
  }, []);

  // Keep focus valid: adopt something sensible when the registry changes and the focused
  // element is gone (a filter changed, a scan removed an entry, an overlay opened).
  useEffect(() => {
    const currentId = focusedIdRef.current;
    const current = currentId ? entries.current.get(currentId) : undefined;
    const inScope = !current || scope === null || current.group === scope;

    const pool = candidates();
    if (pool.length === 0) return;
    // Whatever surface is in play - tiles, desktop icons, settings rows - as opposed to chrome.
    const content = pool.filter((c) => !isChrome(entries.current.get(c.id)?.group));

    if (current && current.element.isConnected && inScope) {
      // Focus is valid. The one case worth revisiting: the engine parked it on chrome - the nav
      // bar - because there was nothing else registered at the time. As soon as a surface
      // exists, move onto it. A focus the user placed is never overridden.
      if (autoPlacedRef.current && isChrome(current.group) && content.length > 0) {
        const first = firstInReadingOrder(content);
        if (first) applyFocus(first.id);
      }
      return;
    }

    // Prefer whatever is nearest to where focus just was, so the eye is not thrown across the
    // screen when an entry disappears or an overlay takes over. When the entry itself is gone
    // from the registry - a filter changed, a background scan re-sorted the list - the remembered
    // rect stands in for it, rather than dropping straight to the first tile.
    //
    // A pad user keeps a visible focus through that: closing a window with the D-pad must land on
    // the desktop with the ring already showing, not quietly waiting for another press.
    const previousRect =
      current?.element.isConnected ? current.element.getBoundingClientRect() : lastRectRef.current;
    if (previousRect) {
      const next = nearestTo(previousRect, pool);
      if (next) applyFocus(next.id, focusSourceRef.current === 'nav' ? 'nav' : 'auto');
      return;
    }

    // Genuinely the first focus of the session - there is no remembered rect yet. Content rather
    // than the nav bar, which is always the top-left thing on screen and would leave the hero
    // panel blank.
    const next = firstInReadingOrder(content.length > 0 ? content : pool);
    if (next) applyFocus(next.id);
  }, [registryVersion, scope, candidates, applyFocus]);

  const value = useMemo<FocusContextValue>(
    () => ({
      focusedId,
      focusSource,
      scope,
      setScope,
      register,
      pointerHasMoved,
      focus,
      focusFirst,
      move,
      activate,
    }),
    [focusedId, focusSource, scope, register, pointerHasMoved, focus, focusFirst, move, activate],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useFocus must be used inside a <FocusProvider>');
  return ctx;
}

export interface FocusableResult {
  ref: (element: HTMLElement | null) => void;
  focused: boolean;
  /**
   * Focused, *and* the focus should be shown: placed by the D-pad or keyboard rather than by the
   * pointer or the engine. A surface with its own hover state, or a quiet rest state, draws its
   * focus visuals from this rather than from `focused` - see `FocusSource`.
   */
  visible: boolean;
  /** Spread onto the element: focus ring hook, mouse support, accessibility. */
  props: {
    'data-focused': true | undefined;
    tabIndex: number;
    onMouseEnter: () => void;
    /** `detail` 0 is a click synthesised by the keyboard, which is navigation, not the pointer. */
    onClick: (event?: { detail?: number }) => void;
  };
}

/**
 * Register one element with the focus engine.
 *
 * Mouse and D-pad share a single notion of focus: hovering moves focus rather than running a
 * parallel highlight, so the hero panel and colour bleed always describe the same item however
 * the user is driving. Whether that focus is *drawn* is `visible`.
 */
export function useFocusable(options: FocusableOptions): FocusableResult {
  const { id, group, onActivate, onFocus, disabled } = options;
  const { focusedId, focusSource, register, focus, pointerHasMoved } = useFocus();
  const elementRef = useRef<HTMLElement | null>(null);

  // Latest callbacks without re-registering on every render.
  const handlers = useRef({ onActivate, onFocus });
  handlers.current = { onActivate, onFocus };

  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    return register({
      id,
      group,
      disabled,
      element,
      onActivate: () => handlers.current.onActivate?.(),
      onFocus: () => handlers.current.onFocus?.(),
    });
  }, [id, group, disabled, register]);

  const focused = focusedId === id;

  return {
    ref,
    focused,
    visible: focused && focusSource === 'nav',
    props: {
      'data-focused': focused || undefined,
      tabIndex: focused ? 0 : -1,
      onMouseEnter: () => {
        // A cursor that merely happens to be here when the window opened has not hovered
        // anything; it has to move at least once first.
        if (!disabled && pointerHasMoved()) focus(id, 'pointer');
      },
      onClick: (event) => {
        if (disabled) return;
        focus(id, event?.detail === 0 ? 'nav' : 'pointer');
        handlers.current.onActivate?.();
      },
    },
  };
}
