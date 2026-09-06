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

import { firstInReadingOrder, nearestTo, pickInDirection, type Candidate, type Direction } from './geometry';

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

export interface FocusContextValue {
  focusedId: string | null;
  /** The group moves are currently confined to. `null` means the whole screen. */
  scope: string | null;
  setScope(group: string | null): void;
  register(entry: FocusEntry): () => void;
  focus(id: string): void;
  focusFirst(group?: string): boolean;
  move(direction: Direction): boolean;
  activate(): boolean;
}

const FocusContext = createContext<FocusContextValue | null>(null);

/** Keeps the focused tile on screen without yanking the page around. */
function revealElement(element: HTMLElement): void {
  element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

export function FocusProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const entries = useRef(new Map<string, FocusEntry>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  // Bumped whenever the registry changes, so the auto-focus effect re-runs.
  const [registryVersion, setRegistryVersion] = useState(0);

  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
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

  const applyFocus = useCallback((id: string) => {
    const entry = entries.current.get(id);
    if (!entry) return;
    autoPlacedRef.current = true;
    setFocusedId(id);
    entry.onFocus?.();
    revealElement(entry.element);
  }, []);

  const focus = useCallback(
    (id: string) => {
      applyFocus(id);
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
        focus(first.id);
        return true;
      }

      const fromRect = current.element.getBoundingClientRect();
      const next = pickInDirection(
        fromRect,
        pool.filter((c) => c.id !== currentId),
        direction,
      );
      if (!next) return false;
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
    const content = pool.filter((c) => entries.current.get(c.id)?.group === 'content');

    if (current && current.element.isConnected && inScope) {
      // Focus is valid. The one case worth revisiting: the engine parked it outside the content
      // - on the nav bar - because there was nothing else registered at the time. As soon as
      // content exists, move onto it. A focus the user placed is never overridden.
      if (autoPlacedRef.current && current.group !== 'content' && content.length > 0) {
        const first = firstInReadingOrder(content);
        if (first) applyFocus(first.id);
      }
      return;
    }

    // Prefer whatever is nearest to where focus just was, so the eye is not thrown across the
    // screen when an entry disappears or an overlay takes over.
    const previousRect = current?.element.isConnected
      ? current.element.getBoundingClientRect()
      : null;
    if (previousRect) {
      const next = nearestTo(previousRect, pool);
      if (next) applyFocus(next.id);
      return;
    }

    // First focus of all: content rather than the nav bar, which is always the top-left thing
    // on screen and would leave the hero panel blank.
    const next = firstInReadingOrder(content.length > 0 ? content : pool);
    if (next) applyFocus(next.id);
  }, [registryVersion, scope, candidates, applyFocus]);

  const value = useMemo<FocusContextValue>(
    () => ({ focusedId, scope, setScope, register, focus, focusFirst, move, activate }),
    [focusedId, scope, register, focus, focusFirst, move, activate],
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
  /** Spread onto the element: focus ring hook, mouse support, accessibility. */
  props: {
    'data-focused': true | undefined;
    tabIndex: number;
    onMouseEnter: () => void;
    onClick: () => void;
  };
}

/**
 * Register one element with the focus engine.
 *
 * Mouse and D-pad share a single notion of focus: hovering moves focus rather than running a
 * parallel highlight, so the hero panel and colour bleed always describe the same item however
 * the user is driving.
 */
export function useFocusable(options: FocusableOptions): FocusableResult {
  const { id, group, onActivate, onFocus, disabled } = options;
  const { focusedId, register, focus } = useFocus();
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
    props: {
      'data-focused': focused || undefined,
      tabIndex: focused ? 0 : -1,
      onMouseEnter: () => {
        if (!disabled) focus(id);
      },
      onClick: () => {
        if (disabled) return;
        focus(id);
        handlers.current.onActivate?.();
      },
    },
  };
}
