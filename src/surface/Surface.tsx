/**
 * `<Surface>` - the one way anything in the shell sits above the desktop.
 *
 * Every raised thing in the app is one of five levels (see `docs/DESIGN.md` and the `elevation`
 * token group), and the level decides all three of: the shadow, the surface tint, and whether
 * this surface is allowed a live `backdrop-filter` right now. That last one is not a style
 * question - it depends on what *else* is on screen - so it is answered by `budget.ts` and
 * arrives here as `data-blur`.
 *
 * The alternative, which this replaces, was every component writing its own `box-shadow` and
 * `backdrop-filter`. That is how a shell ends up with six blurred surfaces on an integrated GPU.
 */

import { useEffect, useId, useSyncExternalStore, type ElementType, type ReactNode } from 'react';

import { claim, release, stateOf, subscribe, type BlurState, type ElevationLevel } from './budget';

/**
 * Whether a level asks for blur at all when nothing else is competing.
 *
 * e0 is the desktop field itself - it *is* the thing everything else blurs - and e1 desktop
 * items ask, but are first to be refused.
 */
const WANTS_BLUR: Record<ElevationLevel, boolean> = {
  e0: false,
  e1: true,
  e2: true,
  e3: true,
  e4: true,
};

/**
 * Subscribe this surface to the blur budget.
 *
 * Exported because a few surfaces (the window frame) need the state before they render their
 * own children, and because it is the honest unit to test.
 */
export function useBlurState(level: ElevationLevel, wants: boolean): BlurState {
  const id = useId();

  useEffect(() => {
    claim(id, level, wants);
    return () => release(id);
  }, [id, level, wants]);

  return useSyncExternalStore(
    subscribe,
    () => stateOf(id),
    () => 'off' as BlurState,
  );
}

export interface SurfaceProps {
  level: ElevationLevel;
  /**
   * Whether this surface wants blur *now*. An unfocused window does not - the design gives glass
   * to the top window only - and passing the focus state here is what keeps a stack of windows
   * down to one blurred surface however many are open.
   *
   * Defaults to whatever the level asks for.
   */
  blur?: boolean;
  /** The element to render. Takes `motion.div` and friends as happily as `'div'`. */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  [prop: string]: unknown;
}

export function Surface({
  level,
  blur,
  as: Component = 'div',
  className,
  children,
  ...rest
}: SurfaceProps): React.JSX.Element {
  const wants = blur ?? WANTS_BLUR[level];
  const state = useBlurState(level, wants);

  return (
    <Component
      {...rest}
      className={['aura-surface', `aura-surface-${level}`, className].filter(Boolean).join(' ')}
      data-blur={state}
    >
      {children}
    </Component>
  );
}
