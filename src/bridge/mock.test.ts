/**
 * The desktop surface, exercised through the mock bridge.
 *
 * This is the contract the UI codes against, and the mock is what `npm run dev` serves, so these
 * tests double as the guarantee that phases 2-7 can be built in a browser. They deliberately
 * assert the same semantics the Rust repositories are tested for - patch-means-partial, pinning
 * is idempotent, deleting a folder prunes its desktop item - because a mock that drifts from the
 * core is worse than no mock at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mockApi, resetMock } from './mock';

beforeEach(() => {
  resetMock();
});

describe('seeded desktop', () => {
  it('serves one desktop laid out with the old home rows as smart folders', async () => {
    const desktops = await mockApi.listDesktops();
    expect(desktops).toHaveLength(1);

    const items = await mockApi.listDesktopItems(desktops[0]!.id);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.kind === 'folder')).toBe(true);
    // Down the first column, in reading order.
    expect(items.map((i) => [i.x, i.y])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);

    const folders = await mockApi.listFolders();
    expect(folders.map((f) => f.label)).toEqual([
      'Games',
      'Apps',
      'Favourites',
      'Recently played',
    ]);
    expect(folders.every((f) => f.kind === 'smart')).toBe(true);
    // Readable locators, not uuids - the same scheme the core uses.
    expect(folders.map((f) => f.path)).toContain('smart:games');
  });

  it('resolves a smart folder to real library items', async () => {
    const games = (await mockApi.listFolders()).find((f) => f.path === 'smart:games')!;
    const contents = await mockApi.folderContents(games.id);

    expect(contents.length).toBeGreaterThan(0);
    expect(contents.every((i) => i.type === 'game')).toBe(true);
    // Hidden entries stay hidden, exactly as `listEntries` would filter them.
    expect(contents.some((i) => i.stats.hidden)).toBe(false);
  });

  it('seeds a taskbar with structure and pins', async () => {
    const bar = await mockApi.listTaskbarItems();
    expect(bar[0]!.kind).toBe('launcher');
    expect(bar.at(-1)!.kind).toBe('system_area');
    expect(bar.filter((i) => i.kind === 'pinned').length).toBeGreaterThan(0);
  });
});

describe('desktop items', () => {
  it('persists a move and leaves everything else alone', async () => {
    const desktop = (await mockApi.listDesktops())[0]!;
    const item = (await mockApi.listDesktopItems(desktop.id))[0]!;

    // What a drag-and-drop sends: position only.
    const moved = await mockApi.updateDesktopItem(item.id, { x: 5, y: 2 });
    expect([moved.x, moved.y]).toEqual([5, 2]);
    expect(moved.targetId).toBe(item.targetId);
    expect(moved.kind).toBe(item.kind);

    const reloaded = (await mockApi.listDesktopItems(desktop.id)).find((i) => i.id === item.id)!;
    expect([reloaded.x, reloaded.y]).toEqual([5, 2]);
  });

  it('refuses to squash an item to nothing', async () => {
    const desktop = (await mockApi.listDesktops())[0]!;
    const item = (await mockApi.listDesktopItems(desktop.id))[0]!;
    const squashed = await mockApi.updateDesktopItem(item.id, { width: 0, height: -3 });
    expect([squashed.width, squashed.height]).toEqual([1, 1]);
  });

  it('adds and removes items', async () => {
    const desktop = (await mockApi.listDesktops())[0]!;
    const added = await mockApi.addDesktopItem({
      desktopId: desktop.id,
      kind: 'shortcut',
      targetId: 'g-solstice',
      x: 3,
      y: 1,
    });
    expect(await mockApi.listDesktopItems(desktop.id)).toHaveLength(5);

    await mockApi.removeDesktopItem(added.id);
    expect(await mockApi.listDesktopItems(desktop.id)).toHaveLength(4);
  });
});

describe('folders', () => {
  it('applies an editor patch without disturbing the rest', async () => {
    const folder = (await mockApi.listFolders())[0]!;
    const edited = await mockApi.updateFolder(folder.id, {
      color: '#3ddc84',
      shape: 'capsule',
      layout: 'covers',
    });

    expect(edited.color).toBe('#3ddc84');
    expect(edited.shape).toBe('capsule');
    expect(edited.layout).toBe('covers');
    expect(edited.label).toBe(folder.label);
    expect(edited.path).toBe(folder.path);
    expect(edited.filter).toEqual(folder.filter);
  });

  it('remembers where a window was left', async () => {
    const folder = (await mockApi.listFolders())[0]!;
    expect(folder.windowState).toBeNull();

    const state = { x: 120, y: 80, width: 900, height: 600, maximised: false };
    await mockApi.updateFolder(folder.id, { windowState: state });
    expect((await mockApi.getFolder(folder.id))!.windowState).toEqual(state);
  });

  it('needs a path for a filesystem folder but not for a virtual one', async () => {
    await expect(mockApi.createFolder({ kind: 'filesystem' })).rejects.toMatchObject({
      code: 'invalid',
    });

    const smart = await mockApi.createFolder({ kind: 'smart', label: 'Never played' });
    expect(smart.path).toBe('smart:never-played');
  });

  it('prunes the desktop item when its folder is deleted', async () => {
    const desktop = (await mockApi.listDesktops())[0]!;
    const folder = (await mockApi.listFolders())[0]!;

    await mockApi.deleteFolder(folder.id);
    const left = await mockApi.listDesktopItems(desktop.id);
    expect(left).toHaveLength(3);
    expect(left.some((i) => i.targetId === folder.id)).toBe(false);
  });
});

describe('taskbar', () => {
  it('pins idempotently and unpins by target', async () => {
    const before = (await mockApi.listTaskbarItems()).length;

    const first = await mockApi.pinToTaskbar('g-hollowlight');
    const again = await mockApi.pinToTaskbar('g-hollowlight');
    expect(again.id).toBe(first.id);
    expect(await mockApi.listTaskbarItems()).toHaveLength(before + 1);

    await mockApi.unpinFromTaskbar('g-hollowlight');
    expect(await mockApi.listTaskbarItems()).toHaveLength(before);
  });

  it('reorders without disturbing structural items', async () => {
    const bar = await mockApi.listTaskbarItems();
    const pins = bar.filter((i) => i.kind === 'pinned').map((i) => i.id);
    await mockApi.reorderTaskbar([...pins].reverse());

    const after = await mockApi.listTaskbarItems();
    expect(after.some((i) => i.kind === 'launcher')).toBe(true);
    expect(after.some((i) => i.kind === 'system_area')).toBe(true);
  });
});

describe('desktops', () => {
  it('will not delete the last one', async () => {
    const [only] = await mockApi.listDesktops();
    await expect(mockApi.deleteDesktop(only!.id)).rejects.toMatchObject({ code: 'invalid' });

    const second = await mockApi.createDesktop('Work');
    await mockApi.deleteDesktop(second.id);
    expect(await mockApi.listDesktops()).toHaveLength(1);
  });
});
