/**
 * The taskbar (brief section 6): a detached floating pill.
 *
 * Carries three things: pinned entries, whatever is currently *running*, and a system area with
 * the clock. "Running" is derived every render from the open windows plus the core's active
 * sessions - it is never stored, so it cannot go stale the way a cached list would when a game
 * exits behind the shell's back.
 *
 * **One component for every edge.** Because the bar is a detached pill, moving it is a change of
 * anchor rather than a change of design: `data-position` flips the flex axis and which side the
 * indicators and tooltips sit on, and there is no per-edge code here at all. The theme's
 * `taskbar.edge` and `taskbar.align` tokens are the default; the user's setting wins over them
 * once it has loaded, because an explicit choice should beat a theme's preference.
 *
 * **The clock is the host's.** Time, battery and running sessions all come from
 * `useShellStatus`, which anchors to `get_system_status` and advances locally between polls - so
 * the shell shows the time Windows thinks it is, in the zone Windows is in, without asking once
 * a second. See `src/lib/shellStatus.ts`.
 *
 * This is Aura's own bar inside the shell window: the real Windows taskbar is never moved,
 * hidden or replaced (docs/RISKS.md R3, R13).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { TaskbarAlignment, TaskbarPosition } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { formatClock, formatShortDate } from '@/lib/shellStatus';
import { useShellStatus } from '@/lib/useShellStatus';
import { useDesktopStore, useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { Surface } from '@/surface';
import { useTheme } from '@/theme';
import { useWmStore, visibleWindows, type WindowInstance } from '@/wm';

import { Icon } from '../Icon';

/** How long the pointer must rest on a plate before its tooltip appears. */
export const TOOLTIP_DWELL_MS = 400;

const EDGES: TaskbarPosition[] = ['bottom', 'top', 'left', 'right'];
const ALIGNS: TaskbarAlignment[] = ['center', 'start'];

export function Taskbar(): React.JSX.Element | null {
  const { bundle } = useTheme();
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

  // One poller for the whole app: the clock widget reads the same instant this does.
  const { status, epochMs, offsetMinutes, sessions } = useShellStatus();

  /*
   * The theme's `taskbar.edge` / `taskbar.align` tokens are the default; the user's saved setting
   * wins once it has loaded. Read from the bundle rather than computed style because these are
   * choices, not lengths - and validated, so a theme typo cannot put the bar on no edge at all.
   */
  const tokens = bundle?.tokens?.taskbar;
  const themeEdge = EDGES.includes(tokens?.edge as TaskbarPosition) ? (tokens?.edge as TaskbarPosition) : 'bottom';
  const themeAlign = ALIGNS.includes(tokens?.align as TaskbarAlignment)
    ? (tokens?.align as TaskbarAlignment)
    : 'center';
  const position = settings?.taskbarPosition ?? themeEdge;
  const alignment = settings?.taskbarAlignment ?? themeAlign;
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
        <TaskbarButton id="launcher" label="Home" onActivate={() => setScreen('home')}>
          <Icon name="home" size="1em" />
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
            wide={!vertical}
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

      <span className="aura-taskbar-divider" />

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

        <time
          className="aura-taskbar-clock"
          dateTime={epochMs === null ? undefined : new Date(epochMs).toISOString()}
        >
          {/* Dashes rather than a blank while the first poll is in flight: the bar must not resize. */}
          <span className="aura-type-clock">
            {epochMs === null ? '--:--' : formatClock(epochMs, offsetMinutes)}
          </span>
          {/* The date is dropped on a vertical bar, where there is no room for it. */}
          {vertical || epochMs === null ? null : (
            <small className="aura-type-clock-date">{formatShortDate(epochMs, offsetMinutes)}</small>
          )}
        </time>
      </div>
    </Surface>
  );
}

function TaskbarButton({
  id,
  label,
  running,
  focused,
  wide,
  onActivate,
  onMeasure,
  children,
}: {
  id: string;
  label: string;
  running?: boolean;
  focused?: boolean;
  /** Carries its title beside the icon. False on a vertical bar, which has no room. */
  wide?: boolean;
  onActivate(): void;
  onMeasure?: (element: HTMLElement | null) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const {
    ref,
    visible: navFocused,
    props: focusProps,
  } = useFocusable({
    id: `taskbar:${id}`,
    group: 'taskbar',
    onActivate,
  });
  /*
   * The ring, the bloom and the immediate tooltip belong to D-pad focus. A pointer resting on a
   * plate gets the hover plate and the 400ms dwell - before this, hover *was* focus, so the ring
   * appeared on every pass of the cursor and the dwell never applied.
   */
  const props = { ...focusProps, 'data-focused': navFocused || undefined };
  const element = useRef<HTMLButtonElement | null>(null);
  const [dwelling, setDwelling] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDwell = () => {
    if (dwellTimer.current !== null) {
      clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
  };

  // A timer outliving the button would fire against an unmounted component.
  useEffect(() => clearDwell, []);

  /*
   * Hover waits; focus does not. A keyboard or pad user has no way to "hover for a moment", so
   * making them wait 400ms would be a delay that buys nothing - where on a pointer the dwell is
   * what stops tooltips flashing up as the cursor crosses the bar.
   */
  const showTooltip = navFocused || dwelling;

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
      data-wide={wide || undefined}
      aria-label={label}
      {...props}
      onPointerEnter={() => {
        clearDwell();
        dwellTimer.current = setTimeout(() => setDwelling(true), TOOLTIP_DWELL_MS);
      }}
      onPointerLeave={() => {
        clearDwell();
        setDwelling(false);
      }}
    >
      {children}
      {wide ? <span className="aura-taskbar-title">{label}</span> : null}

      {/*
        Focused and merely running differ in width, ink and glow at once - see taskbar.css. One
        difference would not survive being read from across a room.
      */}
      {focused ? (
        <span className="aura-taskbar-indicator" data-state="focused" aria-hidden="true" />
      ) : running ? (
        <span className="aura-taskbar-indicator" data-state="running" aria-hidden="true" />
      ) : null}

      {showTooltip ? <span className="aura-taskbar-tooltip">{label}</span> : null}
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
  wide,
  onToggle,
  onAnchor,
}: {
  window: WindowInstance;
  focused: boolean;
  wide: boolean;
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
      wide={wide}
      onActivate={onToggle}
      onMeasure={(element) => {
        node.current = element;
      }}
    >
      {win.icon ? <Icon name={win.icon} size="1em" /> : <Icon name="folder" size="1em" />}
    </TaskbarButton>
  );
}
