/**
 * Renders every open window, and owns the two things only this layer can know:
 *
 *  - the desktop area windows are constrained to, measured from the DOM;
 *  - which focus scope is active, which is the answer to overlapping windows (RISKS.md R11).
 *
 * Window *content* comes from a registry keyed by kind, so the manager knows nothing about
 * folders or Settings - phase 4 fills the folder body in without touching this file.
 */

import { AnimatePresence } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import { useFocus } from '@/focus';

import { rectForSnap } from './geometry';
import { useWmStore, type WindowInstance } from './store';
import { Window } from './Window';

/** How a window's body is rendered, chosen by kind. */
export type WindowBodyRenderer = (window: WindowInstance) => ReactNode;

export interface WindowLayerProps {
  /** Missing kinds fall back to a placeholder rather than an empty frame. */
  renderers: Partial<Record<WindowInstance['kind'], WindowBodyRenderer>>;
}

export function WindowLayer({ renderers }: WindowLayerProps): React.JSX.Element {
  const windows = useWmStore((s) => s.windows);
  const focusedId = useWmStore((s) => s.focusedId);
  const bounds = useWmStore((s) => s.bounds);
  const snapPreview = useWmStore((s) => s.snapPreview);
  const minimiseHint = useWmStore((s) => s.minimiseHint);
  const setBounds = useWmStore((s) => s.setBounds);
  const { setScope } = useFocus();

  const layerRef = useRef<HTMLDivElement | null>(null);

  // The area is measured, not assumed: it is what `constrainToDesktop` and every snap divide up,
  // and it changes with the window, the nav bar and (later) the taskbar.
  useLayoutEffect(() => {
    const element = layerRef.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setBounds({ x: box.left, y: box.top, width: box.width, height: box.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [setBounds]);

  /*
   * The scope rule, and the whole reason overlapping windows do not break the focus engine.
   *
   * A focused window confines directional navigation to its own group; with no window focused
   * the scope is cleared and the desktop and nav bar are reachable again. Moving *between*
   * windows is a separate, explicit action (`nextWindow`/`prevWindow` in src/input) - directional
   * movement is never asked to walk out of one window into another, because it cannot be made
   * predictable and would feel broken.
   */
  useEffect(() => {
    setScope(focusedId ? `window:${focusedId}` : null);
    return () => setScope(null);
  }, [focusedId, setScope]);

  const preview = snapPreview ? rectForSnap(snapPreview, bounds) : null;

  return (
    <div ref={layerRef} className="aura-window-layer" data-busy={windows.length > 0 || undefined}>
      {/* Where a dragged window would land. Positioned relative to the layer, hence the offset. */}
      {preview ? (
        <div
          className="aura-window-snap-preview"
          style={{
            left: preview.x - bounds.x,
            top: preview.y - bounds.y,
            width: preview.width,
            height: preview.height,
          }}
        />
      ) : null}

      {/* `custom` is how the minimise destination reaches a window that is already unmounting. */}
      <AnimatePresence custom={minimiseHint}>
        {windows
          .filter((w) => w.mode !== 'minimised')
          .map((w) => (
            <Window key={w.id} window={w}>
              {renderers[w.kind]?.(w) ?? (
                <div className="aura-window-placeholder">
                  <p>Nothing renders a {w.kind} window yet.</p>
                </div>
              )}
            </Window>
          ))}
      </AnimatePresence>
    </div>
  );
}
