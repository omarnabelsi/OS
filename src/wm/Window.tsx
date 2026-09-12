/**
 * One window: title bar, controls, body, resize handles.
 *
 * A DOM element inside the single webview - never a real OS window (brief 4.3).
 *
 * Focus scoping is the important part. Everything inside a window registers in the focus group
 * `window:<id>`, and the *focused* window sets that group as the engine's scope. Directional
 * navigation is then confined to it, which is the only workable answer to overlapping windows:
 * a tile in a background window is geometrically "to the right of" one in the foreground, and
 * must never receive focus (docs/RISKS.md R11).
 *
 * The window grows from wherever it was opened. `origin` is the point on screen the user acted
 * on - the folder they activated - and it becomes the transform origin, so the open animation
 * expands out of that folder rather than out of the middle of the screen. With the desktop
 * blurring and dimming behind it at the same moment (window.css), opening a folder reads as the
 * folder having grown, which is the whole point of it being the same glass one level up.
 */

import { motion, type Variants } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

import { useFocusable } from '@/focus';
import { useSettingsStore } from '@/store';
import { Surface } from '@/surface';

import { Icon } from '../components/Icon';
import { constrainToDesktop, resizeRect, snapRegionFor, type ResizeEdge, type Rect } from './geometry';
import { useWmStore, type MinimiseHint, type WindowInstance } from './store';

const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Open and close, in seconds. The design's 420ms emphasised. */
const OPEN_SECONDS = 0.42;

export interface WindowProps {
  window: WindowInstance;
  children: ReactNode;
}

export function Window({ window: win, children }: WindowProps): React.JSX.Element {
  const reduceMotion = useSettingsStore((s) => s.settings?.reduceMotion ?? false);
  const bounds = useWmStore((s) => s.bounds);
  const focusedId = useWmStore((s) => s.focusedId);
  const focus = useWmStore((s) => s.focus);
  const close = useWmStore((s) => s.close);
  const minimise = useWmStore((s) => s.minimise);
  const toggleMaximise = useWmStore((s) => s.toggleMaximise);
  const move = useWmStore((s) => s.move);
  const resize = useWmStore((s) => s.resize);
  const applySnap = useWmStore((s) => s.applySnap);
  const setSnapPreview = useWmStore((s) => s.setSnapPreview);

  const focused = focusedId === win.id;
  const group = `window:${win.id}`;

  // The geometry the gesture started from, plus the snap it is currently over.
  const gesture = useRef<{ rect: Rect; edge: ResizeEdge | null; snap: ReturnType<typeof snapRegionFor> } | null>(
    null,
  );

  const rect = win.mode === 'maximised' ? bounds : win.rect;

  /*
   * A press on one of the controls is a click, never the start of a drag.
   *
   * Missing this killed all three buttons. The title bar captured the pointer on *every* press,
   * including presses that began on a button, and pointer capture retargets the pointerup to the
   * capturing element - so the click the browser synthesises landed on the title bar, never on
   * the button under the cursor. The buttons looked fine and did nothing. Checks that call
   * `element.click()` skip pointer events entirely, which is how it got past them.
   *
   * Every button in the bar matches, the back chevron included - it sits in the left cluster
   * rather than with the window controls, and would otherwise be the one dead button left.
   */
  const isControl = (target: EventTarget | null) =>
    target instanceof Element && target.closest('.aura-window-control') !== null;

  const startTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isControl(event.target)) return;
    if (event.button !== 0) return;
    focus(win.id);
    // Dragging a maximised window restores it first, the way Windows does.
    const from = win.mode === 'maximised' ? win.rect : rect;
    gesture.current = { rect: { ...from }, edge: null, snap: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (!state || state.edge) return;

    if (win.mode === 'maximised') toggleMaximise(win.id);

    const dx = event.movementX;
    const dy = event.movementY;
    state.rect = constrainToDesktop(
      { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy },
      bounds,
    );
    move(win.id, state.rect);

    // Snap arms on the pointer, not the window: dragging *to* an edge is the gesture.
    state.snap = snapRegionFor({ x: event.clientX, y: event.clientY }, bounds);
    setSnapPreview(state.snap);
  };

  const endTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const state = gesture.current;
    gesture.current = null;
    if (state?.snap) applySnap(win.id, state.snap);
    else setSnapPreview(null);
  };

  const startResize = (edge: ResizeEdge) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    focus(win.id);
    gesture.current = { rect: { ...rect }, edge, snap: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (!state?.edge) return;
    // Accumulate on the stored rect so the pointer never drifts from the edge it grabbed.
    state.rect = resizeRect(state.rect, state.edge, event.movementX, event.movementY);
    resize(win.id, state.rect);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gesture.current = null;
  };

  // The controls are focusables in the window's own group, so a D-pad can reach them.
  const backButton = useFocusable({ id: `${group}:back`, group, onActivate: () => close(win.id) });
  const closeButton = useFocusable({ id: `${group}:close`, group, onActivate: () => close(win.id) });
  const minButton = useFocusable({ id: `${group}:minimise`, group, onActivate: () => minimise(win.id) });
  const maxButton = useFocusable({
    id: `${group}:maximise`,
    group,
    onActivate: () => toggleMaximise(win.id),
  });

  /*
   * Closing and minimising must not look the same.
   *
   * A close is a dismissal, so the window simply goes. A minimise is a *move* - the window is
   * still there, it is on the taskbar - so it flies to where its taskbar button is and shrinks
   * into it, which is what tells the user where to look to get it back. The destination arrives
   * through `AnimatePresence custom` because an unmounting component has no props left to read.
   */
  const variants: Variants = {
    enter: reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 },
    visible: {
      opacity: 1,
      scale: 1,
      x: 0,
      y: 0,
      transition: reduceMotion
        ? { duration: 0 }
        : { duration: OPEN_SECONDS, ease: [0.05, 0.7, 0.1, 1] as const },
    },
    exit: (hint: MinimiseHint | null | undefined) => {
      if (reduceMotion) return { opacity: 0, transition: { duration: 0 } };
      if (hint?.id !== win.id) {
        // Back into the folder it grew from, on the same curve it opened with.
        return {
          opacity: 0,
          scale: 0.94,
          transition: { duration: OPEN_SECONDS, ease: [0.05, 0.7, 0.1, 1] as const },
        };
      }
      return {
        opacity: 0,
        scale: 0.16,
        // A transform, so it composes with the layout position rather than replacing it.
        x: hint.point.x - (rect.x + rect.width / 2),
        y: hint.point.y - (rect.y + rect.height / 2),
        transition: { duration: 0.24, ease: [0.4, 0, 0.9, 0.3] as const },
      };
    },
  };

  return (
    <motion.section
      className="aura-window"
      data-focused={focused || undefined}
      data-mode={win.mode}
      aria-label={win.title}
      style={{
        // Geometry is kept in viewport coordinates (that is what the pointer reports and what
        // snapping divides up), but the element is positioned inside the layer, so subtract the
        // layer's origin here. `WindowLayer` offsets the snap preview the same way.
        left: rect.x - bounds.x,
        top: rect.y - bounds.y,
        width: rect.width,
        height: rect.height,
        zIndex: win.zIndex,
        // Grow from whatever was activated to open this - see the file header.
        transformOrigin: win.origin
          ? `${Math.round(win.origin.x - rect.x)}px ${Math.round(win.origin.y - rect.y)}px`
          : 'center center',
      }}
      variants={variants}
      initial="enter"
      animate="visible"
      exit="exit"
      // Clicking anywhere in a window raises it - the rule people expect without being told.
      onPointerDownCapture={() => {
        if (!focused) focus(win.id);
      }}
    >
      {/*
        The frame is what clips, and it is separate from the window for a reason: the resize
        handles are siblings of it, not children. With the radius and `overflow: hidden` on one
        element, a rounded corner cut the corner handles away - `elementFromPoint` at the very
        corner returned the desktop behind, so diagonal resize was close to unusable.
      */}
      {/* e3, and only while focused: the design gives glass to the top window alone, which is
          also what keeps a stack of ten windows down to one blurred surface. */}
      <Surface level="e3" blur={focused} className="aura-window-frame">
        <div
          className="aura-window-title"
          onPointerDown={startTitleDrag}
          onPointerMove={moveTitleDrag}
          onPointerUp={endTitleDrag}
          onPointerCancel={endTitleDrag}
          // A quick double press on a control is two clicks, not also a title-bar double-click.
          onDoubleClick={(event) => {
            if (!isControl(event.target)) toggleMaximise(win.id);
          }}
        >
          {/*
            The way out, where the eye looks for it. There is no folder history in V1, so "back"
            is the truthful one: it leaves the folder and returns to the desktop. The window
            controls keep their own close for the pointer.
          */}
          <button
            ref={backButton.ref as React.Ref<HTMLButtonElement>}
            type="button"
            className="aura-window-control aura-window-back"
            aria-label="Back to the desktop"
            title="Back to the desktop"
            {...backButton.props}
          >
            <Icon name="back" size="1em" />
          </button>

          <span className="aura-window-title-divider" aria-hidden="true" />

          {win.icon ? (
            <span className="aura-window-icon" aria-hidden="true">
              <Icon name={win.icon} size="1em" />
            </span>
          ) : null}

          <span className="aura-window-heading">
            <span className="aura-window-name aura-type-window-title">{win.title}</span>
            {win.subtitle ? (
              <span className="aura-window-subtitle aura-type-window-subtitle">{win.subtitle}</span>
            ) : null}
          </span>

          <div className="aura-window-controls">
            <button
              ref={minButton.ref as React.Ref<HTMLButtonElement>}
              type="button"
              className="aura-window-control"
              aria-label="Minimise"
              {...minButton.props}
            >
              <span aria-hidden>&#x2013;</span>
            </button>
            {win.resizable ? (
              <button
                ref={maxButton.ref as React.Ref<HTMLButtonElement>}
                type="button"
                className="aura-window-control"
                aria-label={win.mode === 'maximised' ? 'Restore' : 'Maximise'}
                {...maxButton.props}
              >
                <span aria-hidden>{win.mode === 'maximised' ? '❐' : '□'}</span>
              </button>
            ) : null}
            <button
              ref={closeButton.ref as React.Ref<HTMLButtonElement>}
              type="button"
              className="aura-window-control"
              data-danger
              aria-label="Close"
              {...closeButton.props}
            >
              <span aria-hidden>&#x2715;</span>
            </button>
          </div>
        </div>

        <div className="aura-window-body">{children}</div>
      </Surface>

      {win.resizable && win.mode !== 'maximised'
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className="aura-window-resize"
              data-edge={edge}
              onPointerDown={startResize(edge)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          ))
        : null}
    </motion.section>
  );
}
