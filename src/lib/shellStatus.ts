/**
 * The host's clock, power state and running games - polled once for the whole app.
 *
 * Three components want this (the taskbar, the clock widget, the now-playing widget) and a timer
 * each would mean three round trips a second and three clocks a frame out of step with each
 * other. So the poll is a module-level singleton and components subscribe to it.
 *
 * **The clock is the host's, but it does not tick over IPC.** `get_system_status` reports the
 * instant and the machine's UTC offset; between polls the display is advanced from
 * `performance.now()`, and every poll re-anchors it. That makes the host the source of truth -
 * including which timezone the machine is in, which a webview can only infer - without asking it
 * the time once a second, which would be absurd.
 *
 * `performance.now()` and not `Date.now()` for the advance: a monotonic clock cannot jump
 * backwards when NTP corrects the machine, and the correction arrives at the next poll anyway.
 */

import { api } from '@/bridge';
import type { LaunchSession, SystemStatus } from '@/bridge';

/** How often to ask the host. The power state and the clock's drift both change slowly. */
export const POLL_MS = 30_000;
/** How often the displayed time advances. */
export const TICK_MS = 1000;

export interface ShellStatus {
  /** Null until the first successful poll. */
  status: SystemStatus | null;
  /** The host's wall clock, advanced locally since the last poll. Null until the first poll. */
  epochMs: number | null;
  /** Minutes to add to UTC for the host's local time. */
  offsetMinutes: number;
  sessions: LaunchSession[];
}

// ---- formatting ---------------------------------------------------------------------------------

/**
 * Format an instant in the *host's* timezone, in the user's locale.
 *
 * The shift-then-format-as-UTC trick is what makes this possible: `Intl` can format for a named
 * zone but the host reports an offset, so the instant is moved by that offset and then read as
 * UTC. The alternative - formatting in the webview's own zone - would show the wrong time on any
 * machine where the two disagree, which is exactly the case this exists to handle.
 */
export function formatHostTime(
  epochMs: number,
  offsetMinutes: number,
  options: Intl.DateTimeFormatOptions,
): string {
  const shifted = new Date(epochMs + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(shifted);
}

export interface ClockFormatOptions {
  /** Forces 12h/24h. Omitted (the default) leaves the locale's own convention alone. */
  hour12?: boolean;
  showSeconds?: boolean;
}

/** `14:05`, in whatever the user's locale calls that, on the host's clock. */
export function formatClock(
  epochMs: number,
  offsetMinutes: number,
  options: ClockFormatOptions = {},
): string {
  return formatHostTime(epochMs, offsetMinutes, {
    hour: '2-digit',
    minute: '2-digit',
    ...(options.showSeconds ? { second: '2-digit' } : {}),
    ...(options.hour12 !== undefined ? { hour12: options.hour12 } : {}),
  });
}

/** `12 Sep` - the short form for the taskbar. */
export function formatShortDate(epochMs: number, offsetMinutes: number): string {
  return formatHostTime(epochMs, offsetMinutes, { day: 'numeric', month: 'short' });
}

/** `FRIDAY 12 SEPTEMBER` - the widget's caption, uppercased by CSS rather than here. */
export function formatLongDate(epochMs: number, offsetMinutes: number): string {
  return formatHostTime(epochMs, offsetMinutes, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// ---- the singleton poller -----------------------------------------------------------------------

let state: ShellStatus = { status: null, epochMs: null, offsetMinutes: 0, sessions: [] };
const listeners = new Set<() => void>();

/** Where the clock was anchored, and the monotonic reading at that moment. */
let anchor: { epochMs: number; mono: number } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let subscribers = 0;

function publish(next: Partial<ShellStatus>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** The host's time now, from the anchor plus however long the monotonic clock has advanced. */
function projected(): number | null {
  if (!anchor) return null;
  return Math.round(anchor.epochMs + (performance.now() - anchor.mono));
}

/**
 * Ask the host for both readings.
 *
 * Deliberately independent rather than one `Promise.all`: the clock and the running-game list
 * have nothing to do with each other, and a host that cannot enumerate processes must not also
 * stop the clock. Settled separately, each failure costs only its own value.
 */
async function poll(): Promise<void> {
  const [statusResult, sessionsResult] = await Promise.allSettled([
    api.getSystemStatus(),
    api.activeSessions(),
  ]);

  if (statusResult.status === 'fulfilled') {
    const status = statusResult.value;
    // An older host with no clock in its status would anchor the display to 1970; falling back to
    // the local clock keeps a wrong-but-sane time rather than a visibly broken one.
    const hostEpoch =
      Number.isFinite(status.epochMs) && status.epochMs > 0 ? status.epochMs : Date.now();
    const offset = Number.isFinite(status.utcOffsetMinutes)
      ? status.utcOffsetMinutes
      : -new Date().getTimezoneOffset();

    anchor = { epochMs: hostEpoch, mono: performance.now() };
    publish({ status, epochMs: hostEpoch, offsetMinutes: offset });
  } else {
    // A failed read must not stop the clock: keep advancing from the last good anchor.
    publish({ epochMs: projected() });
  }

  if (sessionsResult.status === 'fulfilled') {
    publish({ sessions: sessionsResult.value });
  }
}

/**
 * Advance the display, aligned to the second boundary.
 *
 * A plain 1000ms interval drifts against the real second, so the minute would appear to change up
 * to a second late - on a clock the size of the widget's, that is visible.
 */
function scheduleTick(): void {
  const now = projected();
  const delay = now === null ? TICK_MS : TICK_MS - (now % TICK_MS);
  tickTimer = setTimeout(() => {
    publish({ epochMs: projected() });
    scheduleTick();
  }, delay);
}

function start(): void {
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_MS);
  scheduleTick();
}

function stop(): void {
  if (pollTimer !== null) clearInterval(pollTimer);
  if (tickTimer !== null) clearTimeout(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

export function subscribeShellStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (subscribers++ === 0) start();
  return () => {
    listeners.delete(listener);
    if (--subscribers === 0) stop();
  };
}

export function getShellStatus(): ShellStatus {
  return state;
}

/** Test seam: forget the anchor and every reading. */
export function resetShellStatus(): void {
  stop();
  subscribers = 0;
  listeners.clear();
  anchor = null;
  state = { status: null, epochMs: null, offsetMinutes: 0, sessions: [] };
}
