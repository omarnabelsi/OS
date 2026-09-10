import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, flushMicrotasks, resetFakeApi, sampleItems, sampleSession } from './test-helpers';

// The factory is hoisted above the imports, so it has to pull the helpers in itself.
vi.mock('@/bridge', async () => {
  const helpers = await import('./test-helpers');
  return helpers.fakeBridgeModule();
});

// Imported after the mock so the stores bind to the fake bridge.
const { emitLocal } = await import('@/bridge/events');
const { useLibraryStore, selectGames, selectApps, selectFavourites, selectRecent, selectById } =
  await import('./library');
const { useSettingsStore, SETTINGS_DEBOUNCE_MS } = await import('./settings');
const { useUiStore, NAV_ITEMS, MAX_TOASTS, TOAST_TTL_MS } = await import('./ui');

const libraryInitial = useLibraryStore.getState();
const settingsInitial = useSettingsStore.getState();
const uiInitial = useUiStore.getState();

beforeEach(() => {
  resetFakeApi();
  useLibraryStore.setState({ ...libraryInitial, items: [], byId: {}, loaded: false, error: null, scan: null, session: null });
  useSettingsStore.setState({ ...settingsInitial, settings: null, loaded: false, error: null });
  useUiStore.setState({ ...uiInitial, screen: 'home', overlay: null, toasts: [], focusedItemId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- library ---------------------------------------------------------------------------------

describe('library store', () => {
  it('loads and indexes entries', async () => {
    await useLibraryStore.getState().load();
    const state = useLibraryStore.getState();
    expect(state.items).toHaveLength(sampleItems.length);
    expect(state.loaded).toBe(true);
    expect(state.byId['g-portal']?.name).toBe('Portal 2');
    expect(state.error).toBeNull();
  });

  it('records an error instead of throwing when the core fails', async () => {
    fakeApi.listEntries.mockRejectedValueOnce({ code: 'db', message: 'database is locked' });
    await useLibraryStore.getState().load();
    expect(useLibraryStore.getState().error).toBe('database is locked');
    expect(useLibraryStore.getState().items).toHaveLength(0);
  });

  describe('selectors', () => {
    beforeEach(() => useLibraryStore.getState().load());

    it('split the library by type and flag', () => {
      const state = useLibraryStore.getState();
      expect(selectGames(state).every((i) => i.type === 'game')).toBe(true);
      expect(selectApps(state).every((i) => i.type === 'app')).toBe(true);
      expect(selectFavourites(state).every((i) => i.stats.favourite)).toBe(true);
      expect(selectById('g-portal')(state)?.name).toBe('Portal 2');
      expect(selectById(null)(state)).toBeUndefined();
      expect(selectById('nope')(state)).toBeUndefined();
    });

    it('order recent by last played and exclude never-played items', () => {
      const recent = selectRecent(useLibraryStore.getState());
      expect(recent.every((i) => i.stats.lastPlayed !== null)).toBe(true);
      const times = recent.map((i) => i.stats.lastPlayed ?? 0);
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('return a stable reference while items are unchanged', () => {
      // Without memoisation every `useLibraryStore(selectGames)` would re-render forever.
      const state = useLibraryStore.getState();
      expect(selectGames(state)).toBe(selectGames(state));
    });
  });

  it('toggles favourite optimistically before the round-trip finishes', async () => {
    await useLibraryStore.getState().load();
    expect(useLibraryStore.getState().byId['g-celeste']?.stats.favourite).toBe(false);

    const pending = useLibraryStore.getState().toggleFavourite('g-celeste');
    // Applied immediately, without waiting for the core.
    expect(useLibraryStore.getState().byId['g-celeste']?.stats.favourite).toBe(true);

    await pending;
    expect(useLibraryStore.getState().byId['g-celeste']?.stats.favourite).toBe(true);
    expect(fakeApi.updateEntry).toHaveBeenCalledWith('g-celeste', { favourite: true });
  });

  it('restores an item after a failed removal', async () => {
    await useLibraryStore.getState().load();
    fakeApi.removeEntry.mockRejectedValueOnce({ code: 'db', message: 'nope' });

    const pending = useLibraryStore.getState().remove('g-hades');
    expect(useLibraryStore.getState().byId['g-hades']).toBeUndefined();

    await pending;
    expect(useLibraryStore.getState().byId['g-hades']).toBeDefined();
    expect(useLibraryStore.getState().error).toBe('nope');
  });

  describe('core events', () => {
    let unbind: () => void;

    beforeEach(async () => {
      unbind = useLibraryStore.getState().bindEvents();
      await useLibraryStore.getState().load();
    });
    afterEach(() => unbind());

    it('patches one asset on library://artwork without reloading', async () => {
      const before = fakeApi.listEntries.mock.calls.length;
      emitLocal('library://artwork', {
        entryId: 'g-portal',
        kind: 'grid',
        path: 'C:/cache/grid.jpg',
        source: 'steam_cdn',
      });

      expect(useLibraryStore.getState().byId['g-portal']?.artwork.grid).toBe('C:/cache/grid.jpg');
      expect(useLibraryStore.getState().byId['g-portal']?.artwork.source).toBe('steam_cdn');
      expect(fakeApi.listEntries.mock.calls.length).toBe(before);
    });

    it('ignores artwork for an entry it does not have', () => {
      emitLocal('library://artwork', { entryId: 'ghost', kind: 'grid', path: 'x', source: 'y' });
      expect(useLibraryStore.getState().byId['ghost']).toBeUndefined();
    });

    it('tracks scan progress and clears it when done', async () => {
      emitLocal('library://scan-progress', {
        jobId: 'j1',
        source: 'steam',
        stage: 'parsing',
        found: 3,
        message: null,
        done: false,
      });
      expect(useLibraryStore.getState().scan?.found).toBe(3);

      emitLocal('library://scan-progress', {
        jobId: 'j1',
        source: null,
        stage: 'done',
        found: 3,
        message: null,
        done: true,
      });
      expect(useLibraryStore.getState().scan).toBeNull();
      await flushMicrotasks();
    });

    it('holds the session between process start and exit', async () => {
      emitLocal('process://started', sampleSession);
      expect(useLibraryStore.getState().session?.entryId).toBe('g-portal');

      emitLocal('process://exited', {
        sessionId: sampleSession.sessionId,
        entryId: 'g-portal',
        exitCode: 0,
        durationSecs: 42,
      });
      expect(useLibraryStore.getState().session).toBeNull();
      await flushMicrotasks();
    });

    it('leaves a different session alone when another exits', () => {
      emitLocal('process://started', sampleSession);
      emitLocal('process://exited', {
        sessionId: 'some-other-session',
        entryId: 'g-hades',
        exitCode: 0,
        durationSecs: 1,
      });
      expect(useLibraryStore.getState().session?.sessionId).toBe(sampleSession.sessionId);
    });
  });
});

// ---- settings ---------------------------------------------------------------------------------

describe('settings store', () => {
  it('loads settings from the core', async () => {
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings?.themeId).toBe('aura-default');
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('applies a patch immediately and coalesces the round-trip', async () => {
    vi.useFakeTimers();
    await useSettingsStore.getState().load();

    void useSettingsStore.getState().update({ uiScale: 1.1 });
    void useSettingsStore.getState().update({ uiScale: 1.2 });
    const last = useSettingsStore.getState().update({ uiScale: 1.3 });

    // The local view is already at the latest value...
    expect(useSettingsStore.getState().settings?.uiScale).toBe(1.3);
    // ...and nothing has been sent yet.
    expect(fakeApi.updateSettings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 5);
    await last;

    // A dragged slider must produce one call, carrying the final value.
    expect(fakeApi.updateSettings).toHaveBeenCalledTimes(1);
    expect(fakeApi.updateSettings).toHaveBeenCalledWith({ uiScale: 1.3 });
  });

  it('rolls back and reports when the core rejects a patch', async () => {
    vi.useFakeTimers();
    await useSettingsStore.getState().load();
    fakeApi.updateSettings.mockRejectedValueOnce({ code: 'invalid', message: 'uiScale out of range' });

    const pending = useSettingsStore.getState().update({ uiScale: 9 });
    expect(useSettingsStore.getState().settings?.uiScale).toBe(9);

    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 5);
    await pending;

    expect(useSettingsStore.getState().settings?.uiScale).toBe(1);
    expect(useSettingsStore.getState().error).toBe('uiScale out of range');
  });

  it('flush sends a pending patch without waiting for the debounce', async () => {
    await useSettingsStore.getState().load();
    void useSettingsStore.getState().update({ soundVolume: 0.2 });
    await useSettingsStore.getState().flush();
    expect(fakeApi.updateSettings).toHaveBeenCalledWith({ soundVolume: 0.2 });
  });
});

// ---- ui ------------------------------------------------------------------------------------------

describe('ui store', () => {
  it('cycles screens in both directions and wraps', () => {
    const { nextScreen, prevScreen, setScreen } = useUiStore.getState();
    // Window items (Settings) are not screens, so the cycle walks only the rest.
    const screens = NAV_ITEMS.filter((n) => n.opens === undefined);
    expect(useUiStore.getState().screen).toBe('home');

    nextScreen();
    expect(useUiStore.getState().screen).toBe(screens[1]!.id);

    // From the last screen, moving forward wraps back to the first.
    setScreen(screens[screens.length - 1]!.id);
    nextScreen();
    expect(useUiStore.getState().screen).toBe('home');

    prevScreen();
    expect(useUiStore.getState().screen).toBe(screens[screens.length - 1]!.id);
  });

  it('never cycles onto Settings, which opens as a window rather than a screen', () => {
    const { nextScreen, prevScreen } = useUiStore.getState();
    const visited = new Set<string>();
    for (let i = 0; i < NAV_ITEMS.length * 2; i++) {
      nextScreen();
      visited.add(useUiStore.getState().screen);
    }
    for (let i = 0; i < NAV_ITEMS.length * 2; i++) {
      prevScreen();
      visited.add(useUiStore.getState().screen);
    }
    expect(visited.has('settings')).toBe(false);
    expect(visited.has('media')).toBe(true);
  });

  it('expires toasts and caps how many are shown', () => {
    vi.useFakeTimers();
    const { pushToast } = useUiStore.getState();

    pushToast('info', 'one');
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(TOAST_TTL_MS + 10);
    expect(useUiStore.getState().toasts).toHaveLength(0);

    for (let i = 0; i < MAX_TOASTS + 3; i++) pushToast('info', `t${i}`);
    expect(useUiStore.getState().toasts).toHaveLength(MAX_TOASTS);
    // The oldest are dropped, so the newest are what remain.
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe(`t${MAX_TOASTS + 2}`);
  });

  it('keeps a toast with no ttl until dismissed', () => {
    vi.useFakeTimers();
    useUiStore.getState().pushToast('error', 'sticky', 0);
    vi.advanceTimersByTime(TOAST_TTL_MS * 5);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    const id = useUiStore.getState().toasts[0]!.id;
    useUiStore.getState().dismissToast(id);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    // Dismissing twice is harmless.
    useUiStore.getState().dismissToast(id);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('turns shell://toast into a toast while bound', () => {
    const unbind = useUiStore.getState().bindEvents();
    emitLocal('shell://toast', { level: 'warning', message: 'No artwork found' });
    expect(useUiStore.getState().toasts[0]?.message).toBe('No artwork found');
    expect(useUiStore.getState().toasts[0]?.level).toBe('warning');

    unbind();
    emitLocal('shell://toast', { level: 'info', message: 'ignored' });
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });

  it('ref-counts binding so two components can subscribe independently', () => {
    const first = useUiStore.getState().bindEvents();
    const second = useUiStore.getState().bindEvents();

    first();
    emitLocal('shell://toast', { level: 'info', message: 'still listening' });
    expect(useUiStore.getState().toasts).toHaveLength(1);

    second();
    emitLocal('shell://toast', { level: 'info', message: 'now silent' });
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });
});
