/**
 * Window state.
 *
 * Lives in the UI, not the database (docs/IPC.md): windows come and go with the session, and
 * writing a drag frame to SQLite would be absurd. The one thing that *is* persisted is a
 * folder's last geometry, written when its window settles - phase 4 wires that up.
 *
 * Every window is a DOM element inside the single Tauri webview. Never a real OS window: one
 * webview keeps theming, focus, motion and z-order ours, and sidesteps per-window DPI and
 * decoration problems on Windows (brief section 4.3).
 */

import { create } from 'zustand';

import type { IconName } from '@/components/Icon';

import {
  cascadeRect,
  clampSize,
  constrainToDesktop,
  rectForSnap,
  type Rect,
  type SnapRegion,
} from './geometry';

export type WindowKind = 'folder' | 'folderEditor' | 'settings' | 'app' | 'widget';
export type WindowMode = 'normal' | 'maximised' | 'minimised';

export interface Point {
  x: number;
  y: number;
}

export interface WindowInstance {
  id: string;
  kind: WindowKind;
  /** `Folder.id` for a folder window; unused for singletons like Settings. */
  targetId: string | null;
  title: string;
  /** The quiet second line beside the title. Null when there is nothing true to say. */
  subtitle: string | null;
  icon: IconName | null;
  /**
   * The icon's colour when the folder it names has one the user chose, or null.
   *
   * Never a hardcoded accent (11a) - the title bar's icon is ink unless a folder was explicitly
   * tinted, in which case it shows *that* colour, cyan included. The mockup's icon was cyan
   * because the folder behind it happened to be tinted that way, not because a folder icon is
   * accent by default.
   */
  iconColor: string | null;
  /** Geometry in the *normal* mode. Maximise does not overwrite it. */
  rect: Rect;
  mode: WindowMode;
  zIndex: number;
  resizable: boolean;
  /**
   * Where on screen the window was opened from, in viewport pixels, or null.
   *
   * The transform origin of the open animation, so a window expands out of the folder that was
   * activated rather than out of the middle of the screen. Geometry the *window manager* does
   * not interpret: it is handed to `Window` and used for nothing else.
   */
  origin: Point | null;
}

/**
 * The window that is minimising and where it should fly to, in viewport pixels.
 *
 * A minimising window unmounts, so by the time the exit animation runs there are no props left
 * to read - framer-motion's `AnimatePresence custom` is the way the destination reaches it.
 */
export interface MinimiseHint {
  id: string;
  point: Point;
}

/** What `open()` needs. Geometry is chosen for you unless you supply it. */
export interface OpenWindowSpec {
  kind: WindowKind;
  targetId?: string | null;
  title: string;
  subtitle?: string | null;
  icon?: IconName | null;
  iconColor?: string | null;
  rect?: Rect;
  /**
   * A preferred size, still placed by the cascade. `rect` pins position *and* size, which is
   * right for restoring a remembered window and wrong for "this one wants to be narrow".
   */
  size?: { width: number; height: number };
  /** Reopen maximised, for a folder that was maximised when it was last closed. */
  mode?: Extract<WindowMode, 'normal' | 'maximised'>;
  resizable?: boolean;
  /** The point the window should appear to grow out of - see `WindowInstance.origin`. */
  origin?: Point | null;
}

export interface WmState {
  windows: WindowInstance[];
  /** The window that owns keyboard focus, or null when the desktop does. */
  focusedId: string | null;
  /** The area windows live in, in viewport pixels. Set by `WindowLayer`. */
  bounds: Rect;
  /** Live snap preview while a title bar is being dragged. */
  snapPreview: SnapRegion | null;
  /**
   * Where each window's taskbar button is, registered by the taskbar in phase 5. A window with
   * no entry minimises toward the bottom centre of the desktop, which is where the taskbar goes
   * by default - so the gesture reads correctly before the taskbar exists.
   */
  minimiseAnchors: Record<string, Point>;
  /** Set for the duration of one minimise, so the exit animation knows where to go. */
  minimiseHint: MinimiseHint | null;

  setBounds(bounds: Rect): void;
  setMinimiseAnchor(id: string, point: Point | null): void;

  /** Open, or focus and restore the window already showing this target. */
  open(spec: OpenWindowSpec): string;
  close(id: string): void;
  focus(id: string): void;
  /** Give focus back to the desktop without closing anything. */
  blurAll(): void;

  minimise(id: string): void;
  toggleMaximise(id: string): void;
  restore(id: string): void;
  /** Minimise if focused, otherwise focus - what a taskbar button does. */
  toggleFromTaskbar(id: string): void;

  move(id: string, rect: Rect): void;
  resize(id: string, rect: Rect): void;
  applySnap(id: string, region: SnapRegion): void;
  setSnapPreview(region: SnapRegion | null): void;

  /** Cycle focus through the windows that are actually on screen. */
  focusNext(direction: 1 | -1): void;
}

const TOP_Z = 100;

/** Windows a user can actually switch to: open and not minimised. */
export function visibleWindows(windows: WindowInstance[]): WindowInstance[] {
  return windows.filter((w) => w.mode !== 'minimised');
}

/** Re-number z-indices from the current order so they never drift upwards forever. */
function restack(windows: WindowInstance[], topId: string | null): WindowInstance[] {
  const others = windows.filter((w) => w.id !== topId);
  const ordered = [...others].sort((a, b) => a.zIndex - b.zIndex);
  const top = windows.find((w) => w.id === topId);
  const sequence = top ? [...ordered, top] : ordered;
  const z = new Map(sequence.map((w, i) => [w.id, TOP_Z + i]));
  return windows.map((w) => ({ ...w, zIndex: z.get(w.id) ?? w.zIndex }));
}

/** Where a new window goes: an exact rect if one was given, else a cascade at its wanted size. */
function placement(spec: OpenWindowSpec, bounds: Rect, openCount: number): Rect {
  if (spec.rect) return spec.rect;
  const cascade = cascadeRect(bounds, openCount);
  if (!spec.size) return cascade;
  // Take the asked-for size, capped to the desktop, then pull the cascade position back so the
  // whole window fits. A window that opened hanging off the bottom was not merely untidy:
  // focusing a control inside it made the browser scroll the desktop surface to reveal it, and
  // every icon and window slid up under the nav bar.
  const width = Math.min(spec.size.width, bounds.width);
  const height = Math.min(spec.size.height, bounds.height);
  return {
    x: Math.max(bounds.x, Math.min(cascade.x, bounds.x + bounds.width - width)),
    y: Math.max(bounds.y, Math.min(cascade.y, bounds.y + bounds.height - height)),
    width,
    height,
  };
}

let windowSeq = 0;

export const useWmStore = create<WmState>()((set, get) => ({
  windows: [],
  focusedId: null,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  snapPreview: null,
  minimiseAnchors: {},
  minimiseHint: null,

  setMinimiseAnchor(id, point) {
    const anchors = { ...get().minimiseAnchors };
    if (point) anchors[id] = point;
    else delete anchors[id];
    set({ minimiseAnchors: anchors });
  },

  setBounds(bounds) {
    const previous = get().bounds;
    if (
      previous.x === bounds.x &&
      previous.y === bounds.y &&
      previous.width === bounds.width &&
      previous.height === bounds.height
    ) {
      return;
    }
    // A window that was reachable before a resize must still be reachable after it.
    set({
      bounds,
      windows: get().windows.map((w) => ({
        ...w,
        rect: constrainToDesktop(clampSize(w.rect), bounds),
      })),
    });
  },

  open(spec) {
    const { windows, bounds } = get();

    // One window per target: opening "Games" twice raises the one that is already there,
    // rather than stacking identical windows the way a naive implementation would.
    const existing = windows.find(
      (w) => w.kind === spec.kind && (w.targetId ?? null) === (spec.targetId ?? null),
    );
    if (existing) {
      get().restore(existing.id);
      get().focus(existing.id);
      return existing.id;
    }

    const id = `win-${++windowSeq}`;
    const instance: WindowInstance = {
      id,
      kind: spec.kind,
      targetId: spec.targetId ?? null,
      title: spec.title,
      subtitle: spec.subtitle ?? null,
      icon: spec.icon ?? null,
      iconColor: spec.iconColor ?? null,
      rect: constrainToDesktop(clampSize(placement(spec, bounds, windows.length)), bounds),
      mode: spec.mode ?? 'normal',
      zIndex: TOP_Z + windows.length,
      resizable: spec.resizable ?? true,
      origin: spec.origin ?? null,
    };

    set({ windows: restack([...windows, instance], id), focusedId: id });
    return id;
  },

  close(id) {
    const remaining = get().windows.filter((w) => w.id !== id);
    // Focus falls to the topmost window still on screen, or back to the desktop.
    const next = visibleWindows(remaining).sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null;
    const anchors = { ...get().minimiseAnchors };
    delete anchors[id];
    set({
      windows: remaining,
      focusedId: get().focusedId === id ? next : get().focusedId,
      minimiseAnchors: anchors,
      // A closing window must not inherit the minimise flight of an earlier one.
      minimiseHint: get().minimiseHint?.id === id ? null : get().minimiseHint,
    });
  },

  focus(id) {
    const window = get().windows.find((w) => w.id === id);
    if (!window) return;
    set({
      windows: restack(get().windows, id),
      focusedId: id,
    });
  },

  blurAll() {
    set({ focusedId: null });
  },

  minimise(id) {
    const { windows, bounds, minimiseAnchors } = get();
    if (!windows.some((w) => w.id === id)) return;
    const remaining = windows.map((w) => (w.id === id ? { ...w, mode: 'minimised' as const } : w));
    const next = visibleWindows(remaining).sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null;
    set({
      windows: remaining,
      focusedId: get().focusedId === id ? next : get().focusedId,
      minimiseHint: {
        id,
        point: minimiseAnchors[id] ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      },
    });
  },

  toggleMaximise(id) {
    set({
      windows: get().windows.map((w) =>
        // `rect` is untouched: it is the geometry to come back to.
        w.id === id ? { ...w, mode: w.mode === 'maximised' ? 'normal' : 'maximised' } : w,
      ),
    });
    get().focus(id);
  },

  restore(id) {
    set({
      windows: get().windows.map((w) => (w.id === id && w.mode === 'minimised' ? { ...w, mode: 'normal' } : w)),
      // Spent: the window is coming back, and a stale hint would make a later *close* fly to
      // the taskbar as though it had been minimised.
      minimiseHint: get().minimiseHint?.id === id ? null : get().minimiseHint,
    });
  },

  toggleFromTaskbar(id) {
    const { windows, focusedId } = get();
    const window = windows.find((w) => w.id === id);
    if (!window) return;
    if (window.mode === 'minimised') {
      get().restore(id);
      get().focus(id);
    } else if (focusedId === id) {
      get().minimise(id);
    } else {
      get().focus(id);
    }
  },

  move(id, rect) {
    const bounds = get().bounds;
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, rect: constrainToDesktop(rect, bounds) } : w,
      ),
    });
  },

  resize(id, rect) {
    const bounds = get().bounds;
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, rect: constrainToDesktop(clampSize(rect), bounds) } : w,
      ),
    });
  },

  applySnap(id, region) {
    const bounds = get().bounds;
    if (region === 'maximise') {
      set({
        windows: get().windows.map((w) => (w.id === id ? { ...w, mode: 'maximised' } : w)),
        snapPreview: null,
      });
      return;
    }
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, mode: 'normal', rect: rectForSnap(region, bounds) } : w,
      ),
      snapPreview: null,
    });
  },

  setSnapPreview(region) {
    if (get().snapPreview !== region) set({ snapPreview: region });
  },

  focusNext(direction) {
    const open = visibleWindows(get().windows).sort((a, b) => a.zIndex - b.zIndex);
    if (open.length === 0) return;

    const currentIndex = open.findIndex((w) => w.id === get().focusedId);
    if (currentIndex < 0) {
      // Coming from the desktop: step onto the window nearest the front, whichever way the
      // user asked, because "the one you were last looking at" is the useful answer.
      get().focus(open[open.length - 1]!.id);
      return;
    }
    const next = open[(currentIndex + direction + open.length) % open.length]!;
    get().focus(next.id);
  },
}));

/** Reset between tests. Not used by the app. */
export function resetWm(): void {
  windowSeq = 0;
  useWmStore.setState({
    windows: [],
    focusedId: null,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    snapPreview: null,
    minimiseAnchors: {},
    minimiseHint: null,
  });
}
