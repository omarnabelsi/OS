/**
 * Folder edits, window memory and taskbar pins in the desktop store.
 *
 * Folder edits are optimistic because the folder editor's preview has to move on the click,
 * not after a round trip - so what matters is that a refused write rolls back, and that a
 * patch's absent keys and `null`s mean different things.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Folder, FolderWindowState, TaskbarItem } from '@/bridge';

vi.mock('@/bridge', async () => {
  const helpers = await import('./test-helpers');
  return helpers.fakeBridgeModule();
});

const { fakeApi, resetFakeApi } = await import('./test-helpers');
const { useDesktopStore } = await import('./desktop');

const desktop = () => useDesktopStore.getState();

const folder: Folder = {
  id: 'f1',
  path: 'smart:games',
  label: 'Games',
  color: null,
  icon: 'games',
  cover: null,
  layout: 'grid',
  shape: 'rounded',
  kind: 'smart',
  collectionId: null,
  filter: null,
  windowState: null,
  sortOrder: 0,
};

const pin: TaskbarItem = { id: 'pin-1', kind: 'pinned', targetId: 'g-portal', sortOrder: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  for (const fn of [fakeApi.updateFolder, fakeApi.pinToTaskbar, fakeApi.unpinFromTaskbar]) fn.mockReset();
  useDesktopStore.setState({ folders: [{ ...folder }], taskbar: [], error: null });
});

describe('patchFolder', () => {
  it('shows the change before the core has answered', async () => {
    let answer!: (f: Folder) => void;
    fakeApi.updateFolder.mockReturnValue(new Promise<Folder>((resolve) => (answer = resolve)));

    const pending = desktop().patchFolder('f1', { color: '#ff8ccf' });
    expect(desktop().folders[0]!.color).toBe('#ff8ccf');

    answer({ ...folder, color: '#ff8ccf' });
    await pending;
    expect(desktop().error).toBeNull();
  });

  it('rolls back and says so when the core refuses', async () => {
    fakeApi.updateFolder.mockRejectedValue({ code: 'invalid', message: 'label too long' });

    await desktop().patchFolder('f1', { label: 'x'.repeat(500) });

    expect(desktop().folders[0]!.label).toBe('Games');
    expect(desktop().error).not.toBeNull();
  });

  it('treats an absent key as "leave alone" and null as "clear it"', async () => {
    useDesktopStore.setState({ folders: [{ ...folder, cover: 'C:/covers/games.png' }] });
    fakeApi.updateFolder.mockImplementation(async () => ({ ...folder, cover: null }));

    const pending = desktop().patchFolder('f1', { cover: null, label: undefined });

    // `label: undefined` must not have wiped the label on the optimistic copy.
    expect(desktop().folders[0]!.label).toBe('Games');
    expect(desktop().folders[0]!.cover).toBeNull();
    await pending;
  });

  it('ignores a patch for a folder it does not know', async () => {
    await desktop().patchFolder('f-missing', { label: 'Nope' });
    expect(fakeApi.updateFolder).not.toHaveBeenCalled();
  });
});

describe('rememberWindowState', () => {
  const state: FolderWindowState = { x: 40, y: 96, width: 720, height: 480, maximised: false };

  it('writes the geometry onto the folder', async () => {
    fakeApi.updateFolder.mockResolvedValue({ ...folder, windowState: state });
    await desktop().rememberWindowState('f1', state);
    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { windowState: state });
    expect(desktop().folders[0]!.windowState).toEqual(state);
  });

  it('stays silent when the write fails - it is bookkeeping the user did not ask for', async () => {
    fakeApi.updateFolder.mockRejectedValue({ code: 'io', message: 'disk full' });
    await desktop().rememberWindowState('f1', state);
    expect(desktop().error).toBeNull();
  });
});

describe('taskbar pins', () => {
  it('pins an entry, and does not duplicate a pin the core already had', async () => {
    // `pin_to_taskbar` is idempotent: pinning twice returns the same item.
    fakeApi.pinToTaskbar.mockResolvedValue(pin);

    await desktop().pinToTaskbar('g-portal');
    await desktop().pinToTaskbar('g-portal');

    expect(desktop().taskbar).toEqual([pin]);
  });

  it('unpins at once and puts the pin back if the core refuses', async () => {
    useDesktopStore.setState({ taskbar: [pin] });
    let refuse!: (reason: unknown) => void;
    fakeApi.unpinFromTaskbar.mockReturnValue(new Promise<void>((_, reject) => (refuse = reject)));

    const pending = desktop().unpinFromTaskbar('g-portal');
    expect(desktop().taskbar).toEqual([]);

    refuse({ code: 'io', message: 'locked' });
    await pending;
    expect(desktop().taskbar).toEqual([pin]);
    expect(desktop().error).not.toBeNull();
  });
});
