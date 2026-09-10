/**
 * Settings, two-pane (brief section 8): categories down the left, rows on the right, and a
 * search box that cuts across every category at once.
 *
 * Used twice - as the whole Settings screen and as the body of the Settings window - which is
 * why it takes its focus `group` as a prop rather than assuming `content`. The rows themselves
 * come from `catalog.tsx`, so neither copy can drift from the other and search has something
 * to search.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type ExitHotkeyStatus, type Settings, type ThemeInfo } from '@/bridge';
import { useFocusable } from '@/focus';
import { useLibraryStore, useSettingsStore, useUiStore } from '@/store';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { buildCatalog, EXIT_HOTKEY_CHOICES, searchCatalog, type SettingRowSpec } from './catalog';

export interface SettingsAppProps {
  /** The focus group these controls register in. `window:<id>` inside a window. */
  group?: string;
  /** The screen shows one long column; the window shows the two-pane layout. */
  variant?: 'panes' | 'column';
}

export function SettingsApp({
  group = 'content',
  variant = 'panes',
}: SettingsAppProps): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const settingsError = useSettingsStore((s) => s.error);

  const startScan = useLibraryStore((s) => s.startScan);
  const scan = useLibraryStore((s) => s.scan);
  const itemCount = useLibraryStore((s) => s.items.length);

  const setOverlay = useUiStore((s) => s.setOverlay);
  const openAddEntry = useUiStore((s) => s.openAddEntry);
  const pushToast = useUiStore((s) => s.pushToast);
  const { bundle, error: themeError } = useTheme();

  const [hotkey, setHotkey] = useState<ExitHotkeyStatus | null>(null);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [query, setQuery] = useState('');
  const [openCategory, setOpenCategory] = useState('library');

  const refreshHotkey = useCallback(async () => {
    try {
      setHotkey(await api.getExitHotkeyStatus());
    } catch {
      setHotkey(null);
    }
  }, []);

  useEffect(() => {
    void refreshHotkey();
    void api.listThemes().then(setThemes).catch(() => setThemes([]));
  }, [refreshHotkey]);

  /**
   * Step to the next accelerator an application is allowed to claim.
   *
   * A "press a combination" capture would be nicer with a keyboard, but this is driven by a
   * D-pad too, and a short cycle of known-good combinations is both reachable and impossible
   * to get wrong. The host validates independently and refuses OS-reserved combinations.
   */
  const cycleExitHotkey = useCallback(() => {
    void (async () => {
      const current = useSettingsStore.getState().settings?.exitHotkey ?? '';
      const at = EXIT_HOTKEY_CHOICES.indexOf(current);
      const next = EXIT_HOTKEY_CHOICES[(at + 1) % EXIT_HOTKEY_CHOICES.length]!;
      await update({ exitHotkey: next });
      await refreshHotkey();
    })();
  }, [update, refreshHotkey]);

  const catalog = useMemo(() => {
    if (!settings) return [];
    return buildCatalog({
      settings,
      set: (patch: Partial<Settings>) => void update(patch),
      themeName: bundle?.info.name ?? settings.themeId,
      themeAuthor: bundle?.info.author,
      themes,
      // Through `setActiveTheme`, not a plain settings write: the core loads and validates the
      // theme *before* committing to it, so a broken theme is refused rather than stored and
      // then failing on every start. Settings is re-read because the core wrote `themeId`.
      pickTheme: (id) => {
        void (async () => {
          try {
            await api.setActiveTheme(id);
            await useSettingsStore.getState().load();
          } catch (e) {
            const reason = (e as { message?: string } | null)?.message ?? 'unknown error';
            pushToast('error', `Could not switch theme: ${reason}`);
          }
        })();
      },
      hotkey,
      cycleExitHotkey,
      scanning: Boolean(scan),
      itemCount,
      startScan: () => {
        pushToast('info', 'Scanning your stores');
        void startScan();
      },
      // Settings has no Games/Apps context of its own, so state the default explicitly rather
      // than inheriting whichever screen last opened the overlay.
      addProgram: () => openAddEntry('app'),
      exitShell: () => setOverlay('exit'),
    });
  }, [
    settings,
    update,
    bundle,
    themes,
    hotkey,
    cycleExitHotkey,
    scan,
    itemCount,
    startScan,
    pushToast,
    openAddEntry,
    setOverlay,
  ]);

  const results = useMemo(() => searchCatalog(catalog, query), [catalog, query]);
  const searching = query.trim() !== '';

  if (!settings) {
    return <p className="aura-row-empty">Loading settings…</p>;
  }

  // A search shows every match across every category; otherwise the chosen category alone.
  const shown = searching ? results : results.filter((c) => c.id === openCategory);

  return (
    <div className="aura-settings-app" data-variant={variant}>
      <div className="aura-settings-side">
        <label className="aura-search">
          <Icon name="search" size="1em" />
          <input
            className="aura-input"
            type="search"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
        </label>

        {/* Hidden while searching: results already span every category, so a selected
            category would be a lie about what is on screen. */}
        {searching ? null : (
          <nav className="aura-settings-categories">
            {catalog.map((category) => (
              <CategoryButton
                key={category.id}
                group={group}
                category={category.id}
                title={category.title}
                icon={category.icon}
                active={openCategory === category.id}
                onPick={() => setOpenCategory(category.id)}
              />
            ))}
          </nav>
        )}
      </div>

      <div className="aura-settings-pane">
        {settingsError ? <p className="aura-error">{settingsError}</p> : null}
        {themeError ? <p className="aura-error">{themeError}</p> : null}

        {shown.length === 0 ? (
          <p className="aura-row-empty">Nothing in settings matches “{query.trim()}”.</p>
        ) : (
          shown.map((category) => (
            <section key={category.id} className="aura-setting-group">
              <h3>{category.title}</h3>
              {category.rows.map((row) => (
                <SettingRow key={row.id} group={group} row={row} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function CategoryButton({
  group,
  category,
  title,
  icon,
  active,
  onPick,
}: {
  group: string;
  category: string;
  title: string;
  icon: SettingRowSpec['icon'];
  active: boolean;
  onPick(): void;
}): React.JSX.Element {
  const { ref, props } = useFocusable({
    id: `settings-cat:${group}:${category}`,
    group,
    onActivate: onPick,
  });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-settings-category"
      data-active={active || undefined}
      aria-pressed={active}
      {...props}
    >
      {icon ? <Icon name={icon} size="1.05em" /> : null}
      <span>{title}</span>
    </button>
  );
}

function SettingRow({ group, row }: { group: string; row: SettingRowSpec }): React.JSX.Element {
  const { ref, focused, props } = useFocusable({
    id: `settings:${group}:${row.id}`,
    group,
    onActivate: row.onActivate,
  });

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className="aura-setting"
      role="button"
      {...props}
      onKeyDown={(event) => {
        if (!row.onAdjust) return;
        if (event.key === 'ArrowLeft') row.onAdjust(-1);
        if (event.key === 'ArrowRight') row.onAdjust(1);
      }}
    >
      {row.icon ? <Icon name={row.icon} size="1.15em" /> : null}
      <div className="aura-setting-text">
        <span className="aura-setting-label">{row.label}</span>
        {row.hint ? <span className="aura-setting-hint">{row.hint}</span> : null}
      </div>
      <div className="aura-setting-value">
        {row.onAdjust && focused ? <span className="aura-setting-arrow">‹</span> : null}
        {row.value}
        {row.onAdjust && focused ? <span className="aura-setting-arrow">›</span> : null}
      </div>
    </div>
  );
}
