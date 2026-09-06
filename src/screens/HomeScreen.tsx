/**
 * Home: the rows the active theme asks for.
 *
 * `layout.json` declares which rows exist and how to fill them (`home.rows`), so a theme can
 * reorder or rename the shelves without a code change. If a theme says nothing, a sensible
 * default set is used.
 */

import { useMemo } from 'react';

import type { EntryFilter, LibraryItem } from '@/bridge';
import { TileRow } from '@/components/Tile';
import { selectFavourites, selectGames, selectRecent, useLibraryStore } from '@/store';
import { useTheme } from '@/theme';

interface RowSpec {
  id: string;
  title: string;
  filter?: EntryFilter;
}

const DEFAULT_ROWS: RowSpec[] = [
  { id: 'recent', title: 'Recently played', filter: { sort: 'last_played', limit: 12 } },
  { id: 'favourites', title: 'Favourites', filter: { favouritesOnly: true } },
  { id: 'games', title: 'All games', filter: { type: 'game' } },
];

/**
 * Apply a row's filter to the library we already hold, rather than round-tripping to the core
 * for every shelf. The core stays the source of truth; this is just the same predicate applied
 * to the snapshot in memory.
 */
export function applyRowFilter(
  items: LibraryItem[],
  filter: EntryFilter | undefined,
  precomputed: { recent: LibraryItem[]; favourites: LibraryItem[]; games: LibraryItem[] },
): LibraryItem[] {
  if (!filter) return items;

  let out: LibraryItem[];
  if (filter.sort === 'last_played') out = precomputed.recent;
  else if (filter.favouritesOnly) out = precomputed.favourites;
  else if (filter.type === 'game') out = precomputed.games;
  else out = items;

  if (filter.type && filter.sort === 'last_played') {
    out = out.filter((i) => i.type === filter.type);
  }
  if (filter.source) out = out.filter((i) => i.source === filter.source);
  if (filter.limit != null) out = out.slice(0, filter.limit);
  return out;
}

export function HomeScreen(): React.JSX.Element {
  const { bundle } = useTheme();
  const items = useLibraryStore((s) => s.items);
  const loaded = useLibraryStore((s) => s.loaded);
  const recent = useLibraryStore(selectRecent);
  const favourites = useLibraryStore(selectFavourites);
  const games = useLibraryStore(selectGames);

  const rows = useMemo<RowSpec[]>(() => {
    const declared = bundle?.layout?.home?.rows;
    if (!Array.isArray(declared) || declared.length === 0) return DEFAULT_ROWS;
    return declared.map((row, i) => ({
      id: row.id ?? `row-${i}`,
      title: row.title ?? row.id ?? 'Library',
      filter: row.filter,
    }));
  }, [bundle?.layout?.home?.rows]);

  if (loaded && items.length === 0) {
    return (
      <div className="aura-empty">
        <h2>Your library is empty</h2>
        <p>
          Run a scan from Settings to pull in your Steam games, or add a program by hand with the
          menu button.
        </p>
      </div>
    );
  }

  return (
    <div className="aura-rows">
      {rows.map((row, index) => (
        <TileRow
          key={row.id}
          id={row.id}
          title={row.title}
          items={applyRowFilter(items, row.filter, { recent, favourites, games })}
          // Only the first row explains itself when empty; the rest just disappear.
          emptyMessage={index === 0 ? 'Nothing played yet - pick something below.' : undefined}
        />
      ))}
    </div>
  );
}
