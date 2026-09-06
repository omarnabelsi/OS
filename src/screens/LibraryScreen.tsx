/**
 * The Games and Apps screens: one filterable grid.
 *
 * Search is a plain input on purpose - it is the one place a keyboard beats a D-pad, and the
 * input engine already steps aside while a text field has focus.
 */

import { useMemo, useState } from 'react';

import type { EntryType } from '@/bridge';
import { Icon } from '@/components/Icon';
import { Tile } from '@/components/Tile';
import { useFocusable } from '@/focus';
import { useLibraryStore, useUiStore } from '@/store';

export interface LibraryScreenProps {
  type: EntryType;
  title: string;
  emptyMessage: string;
}

export function LibraryScreen({ type, title, emptyMessage }: LibraryScreenProps): React.JSX.Element {
  const items = useLibraryStore((s) => s.items);
  const launch = useLibraryStore((s) => s.launch);
  const setFocusedItem = useUiStore((s) => s.setFocusedItem);
  const setOverlay = useUiStore((s) => s.setOverlay);

  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(
      (item) => item.type === type && (term === '' || item.name.toLowerCase().includes(term)),
    );
  }, [items, type, query]);

  const addButton = useFocusable({
    id: `${type}:add`,
    group: 'content',
    onActivate: () => setOverlay('addEntry'),
  });

  return (
    <div className="aura-screen">
      <div className="aura-screen-head">
        <h2 className="aura-screen-title">
          {title}
          <span className="aura-row-count">{shown.length}</span>
        </h2>

        <div className="aura-search">
          <Icon name="search" size="1em" />
          <input
            className="aura-input"
            type="search"
            value={query}
            placeholder={`Search ${title.toLowerCase()}`}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <button
          ref={addButton.ref as React.Ref<HTMLButtonElement>}
          type="button"
          className="aura-panel-button"
          {...addButton.props}
        >
          <Icon name="plus" size="1.1em" />
          <span>Add</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="aura-empty">
          <h2>{query ? 'Nothing matches that' : 'Nothing here yet'}</h2>
          <p>{query ? 'Try a shorter search.' : emptyMessage}</p>
        </div>
      ) : (
        <div className="aura-grid">
          {shown.map((item) => (
            <Tile
              key={item.id}
              rowId={`screen-${type}`}
              item={item}
              onActivate={(target) => {
                setFocusedItem(target.id);
                void launch(target.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
