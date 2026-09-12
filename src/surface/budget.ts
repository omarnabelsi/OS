/**
 * How many surfaces may run a live `backdrop-filter` at once.
 *
 * Blur is the most expensive thing the shell draws (docs/RISKS.md R12). The design carries depth
 * mostly in shadow spread and surface alpha and keeps real backdrop blur for the three surfaces
 * where it is actually read as glass: the taskbar, the focused window and an overlay. So this
 * module is an allocator with a hard cap of three, not a style helper.
 *
 * Deliberately outside React. Surfaces mount and unmount constantly, and the grant depends on
 * every *other* surface currently up - a piece of shared state, not a prop anyone can pass down.
 * Components subscribe with `useSyncExternalStore` (see `Surface.tsx`).
 *
 * What a surface that is refused gets instead is the design's own answer: a flat surface at the
 * same alpha, "visually near-identical once something sits above them".
 */

export type ElevationLevel = 'e0' | 'e1' | 'e2' | 'e3' | 'e4';

/**
 * How much blur the whole app may use.
 *
 * - `full`     - up to `BLUR_BUDGET` live blurs, desktop items included.
 * - `no-e1`    - desktop items go flat first; everything else still blurs. Below ~50 fps.
 * - `snapshot` - nobody gets a live blur; every blurred surface uses the shared static snapshot
 *                of the field instead. One composite layer for the whole app. Below ~40 fps.
 * - `off`      - no blur at all, from `blur.surface: 0` or the user's own choice.
 */
export type SurfaceMode = 'full' | 'no-e1' | 'snapshot' | 'off';

/** What one surface should actually paint. */
export type BlurState = 'live' | 'snapshot' | 'off';

/** The cap, from the design: the taskbar, the top window and an overlay. */
export const BLUR_BUDGET = 3;

/**
 * Who keeps their blur when the cap binds.
 *
 * The taskbar outranks the window because the design marks it "always on" - it is the one
 * surface that is up the whole time, so losing its blur is the most visible. Desktop items are
 * last, which is the design's "desktop-item blur is the first thing cut".
 */
const PRIORITY: Record<ElevationLevel, number> = { e0: 0, e1: 1, e3: 2, e2: 3, e4: 4 };

interface Claim {
  id: string;
  level: ElevationLevel;
  /** Whether this surface wants blur at all - an unfocused window does not. */
  wants: boolean;
  /** Registration order, so a tie between equals is settled the same way every time. */
  seq: number;
}

const claims = new Map<string, Claim>();
const listeners = new Set<() => void>();
let granted = new Set<string>();
let mode: SurfaceMode = 'full';
let sequence = 0;

function eligible(claim: Claim): boolean {
  if (!claim.wants) return false;
  if (mode === 'off' || mode === 'snapshot') return false;
  if (mode === 'no-e1' && claim.level === 'e1') return false;
  return true;
}

function recompute(): void {
  const next = new Set<string>();
  const queue = [...claims.values()].filter(eligible);
  // Highest priority first; oldest first within a level.
  queue.sort((a, b) => PRIORITY[b.level] - PRIORITY[a.level] || a.seq - b.seq);
  for (const claim of queue.slice(0, BLUR_BUDGET)) next.add(claim.id);

  if (next.size === granted.size && [...next].every((id) => granted.has(id))) return;
  granted = next;
  for (const listener of listeners) listener();
}

/** Register a surface, or update one already registered. Idempotent per `id`. */
export function claim(id: string, level: ElevationLevel, wants: boolean): void {
  const existing = claims.get(id);
  if (existing && existing.level === level && existing.wants === wants) return;
  claims.set(id, { id, level, wants, seq: existing?.seq ?? sequence++ });
  recompute();
}

export function release(id: string): void {
  if (!claims.delete(id)) return;
  recompute();
}

/** What surface `id` should paint right now. */
export function stateOf(id: string): BlurState {
  if (granted.has(id)) return 'live';
  const entry = claims.get(id);
  if (!entry?.wants || mode === 'off') return 'off';
  // Refused by the cap is not the same as the whole app being in snapshot mode: the design puts
  // a refused surface on a flat fill, and only the fallback mode paints the snapshot.
  return mode === 'snapshot' ? 'snapshot' : 'off';
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setMode(next: SurfaceMode): void {
  if (next === mode) return;
  mode = next;
  recompute();
  // The mode itself changes what a refused surface paints, so notify even when the granted set
  // came out identical - `recompute` stays quiet in that case.
  for (const listener of listeners) listener();
}

export function getMode(): SurfaceMode {
  return mode;
}

/** How many live blurs are running. The cap is only real if something can see it. */
export function liveBlurCount(): number {
  return granted.size;
}

/** Test seam: drop every claim and go back to defaults. */
export function resetBudget(): void {
  claims.clear();
  granted = new Set();
  mode = 'full';
  sequence = 0;
  for (const listener of listeners) listener();
}
