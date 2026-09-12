/**
 * Which widget a `DesktopItemKind.Widget` item draws.
 *
 * The core stores only an id (`target_id`) and knows nothing about what a clock looks like, so
 * this table is the whole binding between the two. An id with no entry renders nothing rather
 * than an error placeholder: a theme or a newer build may place a widget this one does not have,
 * and an empty cell is a better answer than a broken-looking box on someone's desktop.
 */

import { ClockWidget } from './ClockWidget';
import { NowPlayingWidget } from './NowPlayingWidget';

/** Mirrors `WIDGET_*` in `crates/aura-core/src/desktop/mod.rs`. */
export const WIDGETS: Record<string, () => React.JSX.Element> = {
  clock: ClockWidget,
  'now-playing': NowPlayingWidget,
};

export function Widget({ id }: { id: string | null }): React.JSX.Element | null {
  const Component = id ? WIDGETS[id] : undefined;
  return Component ? <Component /> : null;
}

export { ClockWidget } from './ClockWidget';
export { NowPlayingWidget } from './NowPlayingWidget';
