/**
 * The window manager (brief section 4).
 *
 *   import { useWmStore, WindowLayer } from '@/wm';
 *
 * Every window is a DOM element inside the one Tauri webview - never a real OS window. Live
 * geometry is UI state; only a folder's last position is persisted, by the desktop store.
 */

export { WindowLayer } from './WindowLayer';
export type { WindowBodyRenderer, WindowLayerProps } from './WindowLayer';
export { Window } from './Window';
export { useWmStore, visibleWindows, resetWm } from './store';
export type {
  MinimiseHint,
  OpenWindowSpec,
  Point,
  WindowInstance,
  WindowKind,
  WindowMode,
  WmState,
} from './store';
export {
  cascadeRect,
  clampSize,
  constrainToDesktop,
  rectForSnap,
  resizeRect,
  snapRegionFor,
  KEEP_VISIBLE_PX,
  MIN_HEIGHT,
  MIN_WIDTH,
} from './geometry';
export type { Rect, ResizeEdge, SnapRegion } from './geometry';
