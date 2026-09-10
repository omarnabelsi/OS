/**
 * A folder window's body: its three layouts, its empty states, and where it remembers itself.
 *
 * The persistence rule is the part worth pinning down. A drag produces a rect per frame; the
 * window must write its geometry exactly once, after it settles - and must *not* write the
 * geometry it merely opened with, or every open would be a pointless database round trip.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Folder } from '@/bridge';
import type { WindowInstance } from '@/wm';

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});
vi.mock('@/focus', () => ({
  useFocusable: (options: { onActivate?: () => void }) => ({
    ref: () => {},
    focused: false,
    props: { tabIndex: -1, onClick: () => options.onActivate?.() },
  }),
}));
vi.mock('@/theme', () => ({
  useTheme: () => ({ bundle: null, loading: false, error: null, focusScale: 1.08, reload: async () => {} }),
}));

const { fakeApi, makeItem, resetFakeApi } = await import('@/store/test-helpers');
const { useDesktopStore } = await import('@/store');
const { resetWm } = await import('@/wm');
const { FolderWindowBody } = await import('./FolderWindowBody');

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

function win(
  rect = { x: 10, y: 80, width: 600, height: 400 },
  mode: WindowInstance['mode'] = 'normal',
): WindowInstance {
  return { id: 'win-1', kind: 'folder', targetId: 'f1', title: 'Games', icon: null, rect, mode, zIndex: 100, resizable: true };
}

/** Calls to `update_folder` that carried a window geometry, as opposed to a layout change. */
const geometryWrites = () =>
  fakeApi.updateFolder.mock.calls.filter(([, patch]) => patch.windowState !== undefined);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  resetWm();
  useDesktopStore.setState({ folders: [{ ...folder }], error: null });
  fakeApi.folderContents.mockResolvedValue([makeItem('g-portal', 'Portal 2'), makeItem('g-hades', 'Hades')]);
  fakeApi.updateFolder.mockReset();
  fakeApi.updateFolder.mockImplementation(async (_id, patch) => ({ ...folder, ...patch }) as Folder);
});

describe('FolderWindowBody', () => {
  it('counts what the folder holds once it has loaded', async () => {
    render(<FolderWindowBody window={win()} />);
    expect(await screen.findByText('2 items')).toBeDefined();
  });

  it('switches layout on the spot and stores the choice on the folder', async () => {
    const { container } = render(<FolderWindowBody window={win()} />);
    await screen.findByText('2 items');

    fireEvent.click(screen.getByLabelText('List'));

    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { layout: 'list' });
    // Optimistic: the rows are there before the core has answered.
    expect(container.querySelector('.aura-folder[data-layout="list"]')).not.toBeNull();
    expect(container.querySelectorAll('.aura-folder-row')).toHaveLength(2);
  });

  it('explains an empty collection differently from an empty smart folder', async () => {
    useDesktopStore.setState({ folders: [{ ...folder, kind: 'collection' }] });
    fakeApi.folderContents.mockResolvedValue([]);
    render(<FolderWindowBody window={win()} />);
    expect(await screen.findByText('This collection is empty')).toBeDefined();
  });

  it('does not write back the geometry it opened with', async () => {
    render(<FolderWindowBody window={win()} />);
    await sleep(900);
    expect(geometryWrites()).toHaveLength(0);
  });

  it('writes the geometry once, after the window settles, not once per frame', async () => {
    const { rerender } = render(<FolderWindowBody window={win()} />);
    // Two frames of a drag in quick succession.
    rerender(<FolderWindowBody window={win({ x: 50, y: 80, width: 600, height: 400 })} />);
    rerender(<FolderWindowBody window={win({ x: 90, y: 96, width: 600, height: 400 })} />);

    await vi.waitFor(() => expect(geometryWrites()).toHaveLength(1), { timeout: 2000 });
    expect(geometryWrites()[0]).toEqual([
      'f1',
      { windowState: { x: 90, y: 96, width: 600, height: 400, maximised: false } },
    ]);

    // And nothing more arrives for the intermediate frame.
    await sleep(300);
    expect(geometryWrites()).toHaveLength(1);
  });

  it('remembers being maximised', async () => {
    const { rerender } = render(<FolderWindowBody window={win()} />);
    rerender(<FolderWindowBody window={win(undefined, 'maximised')} />);
    await vi.waitFor(() => expect(geometryWrites()).toHaveLength(1), { timeout: 2000 });
    expect(geometryWrites()[0]![1].windowState).toMatchObject({ maximised: true });
  });

  it('flushes an unsaved move when the window closes or minimises', () => {
    const { rerender, unmount } = render(<FolderWindowBody window={win()} />);
    rerender(<FolderWindowBody window={win({ x: 70, y: 80, width: 600, height: 400 })} />);

    // Well inside the settle delay - this position would be lost without the flush.
    unmount();

    expect(geometryWrites()).toEqual([
      ['f1', { windowState: { x: 70, y: 80, width: 600, height: 400, maximised: false } }],
    ]);
  });
});
