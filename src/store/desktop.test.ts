/**
 * Desktop store behaviour, against the mock bridge.
 *
 * The part worth pinning is the optimistic move: a dragged icon has to land under the cursor on
 * the same frame, but must not lie if the write fails. Persistence is checked by re-reading
 * through the bridge, which is what "positions survive a restart" reduces to.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/bridge', async () => {
  const actual = await vi.importActual<typeof import('@/bridge/mock')>('@/bridge/mock');
  const events = await vi.importActual<typeof import('@/bridge/events')>('@/bridge/events');
  return {
    api: actual.mockApi,
    onCoreEvent: events.onCoreEvent,
    emitLocal: events.emitLocal,
    isTauri: () => false,
    isIpcError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  };
});

const { mockApi, resetMock } = await import('@/bridge/mock');
const { useDesktopStore } = await import('./desktop');

const initial = useDesktopStore.getState();

beforeEach(() => {
  resetMock();
  useDesktopStore.setState({
    ...initial,
    desktops: [],
    activeId: null,
    items: [],
    folders: [],
    taskbar: [],
    loaded: false,
    error: null,
  });
});

describe('load', () => {
  it('pulls the seeded surface and selects a desktop', async () => {
    await useDesktopStore.getState().load();
    const s = useDesktopStore.getState();

    expect(s.loaded).toBe(true);
    expect(s.error).toBeNull();
    expect(s.activeId).toBe('desktop-1');
    // Four folder items plus the clock and now-playing widgets.
    expect(s.items).toHaveLength(6);
    expect(s.folders).toHaveLength(4);
    expect(s.taskbar.length).toBeGreaterThan(0);
  });

  it('resolves a desktop item to the folder it points at', async () => {
    await useDesktopStore.getState().load();
    const s = useDesktopStore.getState();
    const first = s.items[0]!;
    expect(s.folderById(first.targetId)?.label).toBe('Games');
    expect(s.folderById(null)).toBeUndefined();
    expect(s.folderById('nope')).toBeUndefined();
  });
});

describe('moveItem', () => {
  it('updates immediately and persists', async () => {
    await useDesktopStore.getState().load();
    const item = useDesktopStore.getState().items[0]!;

    const pending = useDesktopStore.getState().moveItem(item.id, 4, 3);

    // Optimistic: already moved before the bridge answers, or the icon lags the cursor.
    const during = useDesktopStore.getState().items.find((i) => i.id === item.id)!;
    expect([during.x, during.y]).toEqual([4, 3]);

    await pending;

    // ...and it really went to the core, which is what survives a restart.
    const reloaded = await mockApi.listDesktopItems('desktop-1');
    expect(reloaded.find((i) => i.id === item.id)).toMatchObject({ x: 4, y: 3 });
  });

  it('rolls back and reports when the write fails', async () => {
    await useDesktopStore.getState().load();
    const item = useDesktopStore.getState().items[0]!;
    const before = { x: item.x, y: item.y };

    const spy = vi
      .spyOn(mockApi, 'updateDesktopItem')
      .mockRejectedValueOnce({ code: 'invalid', message: 'nope' });

    await useDesktopStore.getState().moveItem(item.id, 9, 9);

    const after = useDesktopStore.getState().items.find((i) => i.id === item.id)!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(useDesktopStore.getState().error).toBeTruthy();
    spy.mockRestore();
  });

  it('does nothing for an item that is not on this desktop', async () => {
    await useDesktopStore.getState().load();
    const before = useDesktopStore.getState().items;
    await useDesktopStore.getState().moveItem('not-here', 1, 1);
    expect(useDesktopStore.getState().items).toBe(before);
  });
});

describe('add and remove', () => {
  it('adds an item and puts it in the list', async () => {
    await useDesktopStore.getState().load();
    const added = await useDesktopStore
      .getState()
      .addItem({ desktopId: 'desktop-1', kind: 'shortcut', targetId: 'g-solstice', x: 2, y: 2 });

    expect(added).not.toBeNull();
    expect(useDesktopStore.getState().items).toHaveLength(7);
  });

  it('removes optimistically and restores if the bridge refuses', async () => {
    await useDesktopStore.getState().load();
    const item = useDesktopStore.getState().items[0]!;

    const spy = vi
      .spyOn(mockApi, 'removeDesktopItem')
      .mockRejectedValueOnce({ code: 'other', message: 'nope' });

    await useDesktopStore.getState().removeItem(item.id);
    // Rolled back to the six seeded items.
    expect(useDesktopStore.getState().items).toHaveLength(6);
    expect(useDesktopStore.getState().error).toBeTruthy();
    spy.mockRestore();

    await useDesktopStore.getState().removeItem(item.id);
    expect(useDesktopStore.getState().items).toHaveLength(5);
  });
});

describe('folder contents', () => {
  it('resolves a smart folder through the bridge', async () => {
    await useDesktopStore.getState().load();
    const games = useDesktopStore.getState().folders.find((f) => f.path === 'smart:games')!;
    const contents = await useDesktopStore.getState().folderContents(games.id);
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.every((i) => i.type === 'game')).toBe(true);
  });
});
