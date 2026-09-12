/**
 * The clock widget: the desktop's largest piece of type.
 *
 * The time comes from the host through `useShellStatus`, not from `new Date()` - see
 * `src/lib/shellStatus.ts` for why that is an anchor rather than a tick.
 *
 * The status line under the date shows what is *actually* happening. The design mocks it up as
 * "3 updates queued", and there is no update queue in this shell - so rather than print a
 * sentence that is decoration pretending to be information, the line reports the running games
 * the core knows about and hides itself when there is nothing to say.
 */

import { formatClock, formatLongDate } from '@/lib/shellStatus';
import { useShellStatus } from '@/lib/useShellStatus';
import { useLibraryStore } from '@/store';

export function ClockWidget(): React.JSX.Element {
  const { epochMs, offsetMinutes, sessions } = useShellStatus();
  const byId = useLibraryStore((s) => s.byId);

  // Named while one game is running, counted while several are: "Hades" beats "1 running".
  const running =
    sessions.length === 0
      ? null
      : sessions.length === 1
        ? `${byId[sessions[0]!.entryId]?.name ?? 'A game'} is running`
        : `${sessions.length} games running`;

  return (
    <div className="aura-widget aura-widget-clock">
      {/* Dashes rather than a blank while the first poll is in flight: the block must not resize. */}
      <div className="aura-widget-clock-time aura-type-clock-hero">
        {epochMs === null ? '--:--' : formatClock(epochMs, offsetMinutes)}
      </div>
      <div className="aura-widget-clock-date aura-type-widget-date">
        {epochMs === null ? ' ' : formatLongDate(epochMs, offsetMinutes)}
      </div>
      {running ? (
        <div className="aura-widget-status">
          <span className="aura-widget-status-dot" aria-hidden="true" />
          <span className="aura-type-tile-meta">{running}</span>
        </div>
      ) : null}
    </div>
  );
}
