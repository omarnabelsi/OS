/**
 * The taskbar (brief section 6).
 *
 * Carries three things: pinned entries, whatever is currently *running*, and a system area
 * with the clock. "Running" is derived every render from the open windows plus the core's
 * active sessions - it is never stored, so it cannot go stale the way a cached list would when
 * a game exits behind the shell's back.
 *
 * Docked to any of the four edges and aligned start or centre, both from settings. This is
 * Aura's own bar inside the shell window: the real Windows taskbar is never moved, hidden or
 * replaced (docs/RISKS.md R3, R13).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { api, type LaunchSession, type SystemStatus } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useDesktopStore, useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { Surface } from '@/surface';
import { useWmStore, visibleWindows, type WindowInstance } from '@/wm';

import { Icon } from '../Icon';

/** How often the system area re-reads. A minute of clock drift is not acceptable; a second of
 *  battery lag is. One second keeps the clock honest and the read is a cheap Win32 call. */
const TICK_MS = 1000;
/** The power state changes far more slowly than the clock, so it is read every 30th tick. */
const STATUS_EVERY = 30;

export function Taskbar(): React.JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings);
  const taskbar = useDesktopStore((s) => s.taskbar);
  const byId = useLibraryStore((s) => s.byId);
  const launch = useLibraryStore((s) => s.launch);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const setScreen = useUiStore((s) => s.setScreen);

  const windows = useWmStore((s) => s.windows);
  const focusedId = useWmStore((s) => s.focusedId);
  const toggleFromTaskbar = useWmStore((s) => s.toggleFromTaskbar);
  const setMinimiseAnchor = useWmStore((s) => s.setMinimiseAnchor);

  const [sessions, setSessions] = useState<LaunchSession[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<SystemStatus | null>(null);

  // One timer for the whole bar. A clock per component would drift apart and cost more.
  useEffect(() => {
    let tick = 0;
    const read = () => {
      setNow(new Date());
      if (tick++ % STATUS_EVERY !== 0) return;
      void api.getSystemStatus().then(setStatus).catch(() => setStatus(null));
      void api.activeSessions().then(setSessions).catch(() => setSessions([]));
    };
    read();
    const timer = setInterval(read, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const position = settings?.taskbarPosition ?? 'bottom';
  const alignment = settings?.taskbarAlignment ?? 'center';
  const vertical = position === 'left' || position === 'right';

  const pinned = useMemo(
    () => taskbar.filter((t) => t.kind === 'pinned' && t.targetId).sort((a, b) => a.sortOrder - b.sortOrder),
    [taskbar],
  );

  const open = useMemo(() => visibleWindows(windows), [windows]);
  const minimised = useMemo(() => windows.filter((w) => w.mode === 'minimised'), [windows]);
  /*
   * Order matters and is deliberately stable: a button must not jump under the cursor because
   * another window was focused. Open windows keep their creation order (`id` is sequential),
   * minimised ones follow.
   */
  const running = useMemo(
    () => [...open, ...minimised].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
    [open, minimised],
  );

  const runningEntryIds = useMemo(() => new Set(sessions.map((s) => s.entryId)), [sessions]);

  if (settings && !settings.taskbarVisible) return null;

  return (
    <Surface level="e2" className="aura-taskbar" data-position={position} data-align={alignment}>
      <div className="aura-taskbar-strip">
        <TaskbarButton
          id="launcher"
          label="Home"
          onActivate={() => setScreen('home')}
        >
          <Icon name="home" size="1.15em" />
        </TaskbarButton>

        {pinned.map((item) => {
          const entry = item.targetId ? byId[item.targetId] : undefined;
          if (!entry) return null;
          const art = assetUrl(entry.artwork.icon ?? entry.artwork.grid ?? undefined);
          return (
            <TaskbarButton
              key={item.id}
              id={item.id}
              label={entry.name}
              // A pinned entry that is *also* running gets the running marker, exactly as a
              // pinned-and-open app does on Windows.
              running={runningEntryIds.has(entry.id)}
              onActivate={() => {
                setFocusedItem(entry.id);
                void launch(entry.id);
              }}
            >
              {art ? <img src={art} alt="" draggable={false} /> : <Icon name="play" size="1em" />}
            </TaskbarButton>
          );
        })}

        {running.length > 0 ? <span className="aura-taskbar-divider" /> : null}

        {running.map((win) => (
          <WindowButton
            key={win.id}
            window={win}
            focused={focusedId === win.id}
            onToggle={() => {
              // Windows live on the desktop, so a window's button takes you there first - and
              // *shows* the window. A toggle would minimise it if it happened to be focused,
              // which from another screen, where it was not visible at all, is backwards.
              if (useUiStore.getState().screen !== 'home') {
                setScreen('home');
                const manager = useWmStore.getState();
                manager.restore(win.id);
                manager.focus(win.id);
                return;
              }
              toggleFromTaskbar(win.id);
            }}
            onAnchor={setMinimiseAnchor}
          />
        ))}
      </div>

      <div className="aura-taskbar-system">
        {status?.hasBattery ? (
          <span
            className="aura-taskbar-battery"
            data-charging={status.charging || undefined}
            title={`${status.batteryPercent ?? '?'}%${status.charging ? ', charging' : ''}`}
          >
            <Icon name="battery" size="1.05em" />
            {status.batteryPercent !== null ? <span>{status.batteryPercent}%</span> : null}
          </span>
        ) : null}

        <time className="aura-taskbar-clock" dateTime={now.toISOString()}>
          <span className="aura-type-clock">{formatTime(now)}</span>
          {/* The date is dropped on a vertical bar, where there is no room for it. */}
          {vertical ? null : <small className="aura-type-clock-date">{formatDate(now)}</small>}
        </time>
      </div>
    </Surface>
  );
}

/** `14:05`, in whatever the user's locale calls that. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function TaskbarButton({
  id,
  label,
  running,
  focused,
  onActivate,
  onMeasure,
  children,
}: {
  id: string;
  label: string;
  running?: boolean;
  focused?: boolean;
  onActivate(): void;
  onMeasure?: (element: HTMLElement | null) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { ref, props } = useFocusable({ id: `taskbar:${id}`, group: 'taskbar', onActivate });
  const element = useRef<HTMLButtonElement | null>(null);

  return (
    <button
      ref={(node) => {
        element.current = node;
        (ref as (n: HTMLElement | null) => void)(node);
        onMeasure?.(node);
      }}
      type="button"
      className="aura-taskbar-button"
      data-running={running || undefined}
      data-active={focused || undefined}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A button for one open window.
 *
 * It also registers where it is, so a minimising window has somewhere real to fly to. That is
 * the whole reason `setMinimiseAnchor` exists: without it the animation aims at the bottom
 * centre of the desktop and the user is shown the wrong place to look.
 */
function WindowButton({
  window: win,
  focused,
  onToggle,
  onAnchor,
}: {
  window: WindowInstance;
  focused: boolean;
  onToggle(): void;
  onAnchor(id: string, point: { x: number; y: number } | null): void;
}): React.JSX.Element {
  const node = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const measure = () => {
      const box = node.current?.getBoundingClientRect();
      onAnchor(win.id, box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);
    };
    measure();
    // The bar re-flows when another window opens or the dock edge changes.
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      onAnchor(win.id, null);
    };
  }, [win.id, onAnchor]);

  return (
    <TaskbarButton
      id={win.id}
      label={win.title}
      running
      focused={focused}
      onActivate={onToggle}
      onMeasure={(element) => {
        node.current = element;
      }}
    >
      {win.icon ? <Icon name={win.icon} size="1em" /> : <Icon name="folder" size="1em" />}
      <span className="aura-taskbar-title">{win.title}</span>
    </TaskbarButton>
  );
}
