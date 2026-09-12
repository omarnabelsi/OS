/**
 * The cheap stand-in for `backdrop-filter`: one static blurred picture of the field, shared by
 * every surface, refreshed twice a second.
 *
 * A real backdrop blur re-filters everything behind the element on every frame, once per
 * blurred surface. This draws the field once into a thumbnail and lets the compositor stretch
 * it - the upscale *is* the blur, and it costs a single texture for the whole app. The design
 * calls this "identical read, one composite layer", and it is what makes an integrated GPU at
 * 4K viable.
 *
 * Surfaces consume it through `--surface-snapshot` with `background-attachment: fixed`, which
 * anchors the image to the viewport rather than to the element. That is exactly what a backdrop
 * is, and it means no surface has to know where it sits on screen.
 *
 * The colours come from the same `--aurora-*` custom properties the CSS field is built from, so
 * there is one definition of what the field looks like, not two that drift apart.
 */

/**
 * Thumbnail size. Small on purpose: every pixel here becomes a soft blob once it is stretched to
 * the screen, and a smaller bitmap is a cheaper encode and a cheaper upload.
 */
const WIDTH = 128;
const HEIGHT = 72;

/** Twice a second, per the design. The field's slowest drift is 68 s, so this is ample. */
export const SNAPSHOT_INTERVAL_MS = 500;

/** Matches the primary drift period in `src/styles/field.css`. */
const DRIFT_PERIOD_MS = 68_000;

/** A blob of the field: which token holds its colour, and where it sits at rest. */
interface Blob {
  /** Custom property holding the colour, and the fallback if the theme does not set it. */
  token: string;
  fallback: string;
  /** Centre, in fractions of the canvas. */
  x: number;
  y: number;
  /** Radius as a fraction of the diagonal. */
  r: number;
  /** How far this blob travels over one drift period, in fractions of the canvas. */
  driftX: number;
  driftY: number;
}

/**
 * The same four radials the CSS field paints, in the same order.
 *
 * Kept here as geometry only - the colours are read from the document, so a theme restyles the
 * snapshot along with the field it stands in for.
 */
const BLOBS: Blob[] = [
  { token: '--aurora-1', fallback: 'rgba(110, 231, 255, 0.26)', x: 0.18, y: 0.22, r: 0.62, driftX: 0.06, driftY: 0.04 },
  { token: '--aurora-2', fallback: 'rgba(118, 108, 255, 0.23)', x: 0.82, y: 0.18, r: 0.66, driftX: -0.05, driftY: 0.05 },
  { token: '--aurora-3', fallback: 'rgba(46, 196, 182, 0.17)', x: 0.28, y: 0.84, r: 0.58, driftX: 0.04, driftY: -0.03 },
  { token: '--aurora-4', fallback: 'rgba(255, 110, 160, 0.07)', x: 0.76, y: 0.78, r: 0.5, driftX: -0.03, driftY: -0.04 },
];

let canvas: HTMLCanvasElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function readToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value === '' ? fallback : value;
}

/**
 * Draw one frame of the field into the thumbnail and return it as a data URL.
 *
 * Exported for the tests, which run without a real canvas implementation and only check that a
 * missing 2D context is handled rather than thrown.
 */
export function paintSnapshot(root: HTMLElement = document.documentElement): string | null {
  if (!canvas) canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const ctx = canvas.getContext('2d');
  // jsdom has no canvas backend, and a browser can refuse a context under memory pressure.
  if (!ctx) return null;

  const styles = getComputedStyle(root);
  const base = readToken(styles, '--color-background', '#07080c');

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // One phase for every blob, so the snapshot drifts with the field instead of sitting still
  // while the real background moves behind the surfaces that are not blurred.
  const phase = Math.sin((performance.now() / DRIFT_PERIOD_MS) * Math.PI * 2);
  const diagonal = Math.hypot(WIDTH, HEIGHT);

  ctx.globalCompositeOperation = 'lighter';
  for (const blob of BLOBS) {
    const cx = (blob.x + blob.driftX * phase) * WIDTH;
    const cy = (blob.y + blob.driftY * phase) * HEIGHT;
    const radius = blob.r * diagonal;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, readToken(styles, blob.token, blob.fallback));
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.globalCompositeOperation = 'source-over';

  return canvas.toDataURL('image/png');
}

/** Paint once and publish the result to `--surface-snapshot`. */
function refresh(root: HTMLElement): void {
  const url = paintSnapshot(root);
  if (url) root.style.setProperty('--surface-snapshot', `url("${url}")`);
}

/**
 * Keep `--surface-snapshot` current. Returns the stop function.
 *
 * Only call this while the app is in snapshot mode: on a machine fast enough for live blur the
 * property is never read, and painting it anyway would be pure waste.
 */
export function startSnapshotLoop(root: HTMLElement = document.documentElement): () => void {
  stopSnapshotLoop(root);
  refresh(root);
  timer = setInterval(() => refresh(root), SNAPSHOT_INTERVAL_MS);
  return () => stopSnapshotLoop(root);
}

export function stopSnapshotLoop(root: HTMLElement = document.documentElement): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  root.style.removeProperty('--surface-snapshot');
}
