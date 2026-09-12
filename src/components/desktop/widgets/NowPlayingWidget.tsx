/**
 * The now-playing widget: a glass panel with art, a title and a second line.
 *
 * "Now playing" here means the game the core has running, not a music track. Aura Shell plays no
 * audio beyond five interface sounds and has no player to report - so a widget showing a song and
 * an artist would be fabricated data dressed as a feature. The running game is the real thing
 * this shell knows, it is what the panel was shaped for, and `active_sessions` already reports it.
 */

import type { LibraryItem } from '@/bridge';
import { assetUrl } from '@/lib/assetUrl';
import { useShellStatus } from '@/lib/useShellStatus';
import { useLibraryStore } from '@/store';
import { Surface } from '@/surface';

import { Icon } from '../../Icon';

/** How long it has been running, in words. Minutes until an hour, then hours and minutes. */
function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'just started';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function NowPlayingWidget(): React.JSX.Element {
  const { sessions, epochMs } = useShellStatus();
  const byId = useLibraryStore((s) => s.byId);

  const session = sessions[0];
  const item: LibraryItem | undefined = session ? byId[session.entryId] : undefined;
  const art = item ? assetUrl(item.artwork.grid ?? item.artwork.icon ?? undefined) : undefined;

  return (
    <Surface level="e1" className="aura-widget aura-widget-now-playing">
      <span className="aura-widget-art">
        {art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <Icon name={session ? 'play' : 'games'} size="1em" />
        )}
      </span>

      <span className="aura-widget-lines">
        <span className="aura-type-tile-label">{item?.name ?? session?.entryId ?? 'Nothing running'}</span>
        <span className="aura-type-tile-meta">
          {session
            ? epochMs === null
              ? 'running'
              : elapsed(session.startedAt, epochMs)
            : 'Pick something to play'}
        </span>
      </span>
    </Surface>
  );
}
