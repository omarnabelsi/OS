/**
 * The taskbar as it mounts: what it shows, and that its buttons do what a taskbar's buttons do.
 *
 * "Running" is derived from open windows every render and never stored, so the interesting
 * cases are the ones a stored list would get wrong - a minimised window must keep its button,
 * and clicking the focused window's button must minimise rather than re-focus it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});

// The focus engine has its own tests; here a focusable only has to be clickable.
vi.mock('@/focus', () => ({
  useFocusable: (options: { onActivate?: () => void }) => ({
    ref: () => {},
    focused: false,
    props: { tabIndex: -1, onClick: () => options.onActivate?.() },
  }),
}));

const { baseSettings, fakeApi, makeItem, resetFakeApi } = await import('@/store/test-helpers');
const { useDesktopStore, useLibraryStore, useSettingsStore } = await import('@/store');
const { resetWm, useWmStore } = await import('@/wm');
const { Taskbar } = await import('./Taskbar');

const wm = () => useWmStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  resetWm();
  useSettingsStore.setState({ settings: { ...baseSettings } });
  useDesktopStore.setState({ taskbar: [] });
  useLibraryStore.setState({ items: [], byId: {} });
});

function openWindow(title: string, targetId: string): string {
  return wm().open({ kind: 'folder', targetId, title });
}

describe('Taskbar', () => {
  it('shows the clock, and no battery on a machine that has none', async () => {
    const { container } = render(<Taskbar />);
    expect(container.querySelector('time')).not.toBeNull();
    // Let the first status read resolve before asserting that it drew nothing.
    await act(async () => {});
    expect(container.querySelector('.aura-taskbar-battery')).toBeNull();
  });

  it('shows the battery level when there is a battery', async () => {
    fakeApi.getSystemStatus.mockResolvedValue({ batteryPercent: 57, charging: false, hasBattery: true });
    render(<Taskbar />);
    expect(await screen.findByText('57%')).toBeDefined();
  });

  it('launches a pinned entry', () => {
    const portal = makeItem('g-portal', 'Portal 2');
    useLibraryStore.setState({ items: [portal], byId: { [portal.id]: portal } });
    useDesktopStore.setState({
      taskbar: [{ id: 'pin-1', kind: 'pinned', targetId: portal.id, sortOrder: 0 }],
    });

    render(<Taskbar />);
    fireEvent.click(screen.getByLabelText('Portal 2'));

    expect(fakeApi.launchEntry).toHaveBeenCalledWith('g-portal');
  });

  it('skips a pin whose entry has left the library rather than drawing a blank button', () => {
    useDesktopStore.setState({
      taskbar: [{ id: 'pin-1', kind: 'pinned', targetId: 'g-gone', sortOrder: 0 }],
    });
    const { container } = render(<Taskbar />);
    // Only the Home button is left.
    expect(container.querySelectorAll('.aura-taskbar-button')).toHaveLength(1);
  });

  it('gives every window a button, minimised ones included', () => {
    const games = openWindow('Games', 'f1');
    openWindow('Apps', 'f2');
    wm().minimise(games);

    render(<Taskbar />);

    // A minimised window with no button would be unreachable - it is not on screen either.
    expect(screen.getByLabelText('Games')).toBeDefined();
    expect(screen.getByLabelText('Apps')).toBeDefined();
  });

  it('minimises the focused window, then restores it, as a taskbar button does', () => {
    const id = openWindow('Games', 'f1');
    render(<Taskbar />);
    const button = screen.getByLabelText('Games');

    fireEvent.click(button);
    expect(wm().windows[0]!.mode).toBe('minimised');

    fireEvent.click(button);
    expect(wm().windows[0]!.mode).toBe('normal');
    expect(wm().focusedId).toBe(id);
  });

  it('brings a background window to the front instead of minimising it', () => {
    const games = openWindow('Games', 'f1');
    openWindow('Apps', 'f2');
    render(<Taskbar />);

    fireEvent.click(screen.getByLabelText('Games'));

    expect(wm().focusedId).toBe(games);
    expect(wm().windows.find((w) => w.id === games)!.mode).toBe('normal');
  });

  it('registers where each window button is, so a minimise has somewhere real to fly to', () => {
    const id = openWindow('Games', 'f1');
    render(<Taskbar />);
    expect(wm().minimiseAnchors[id]).toBeDefined();
  });

  it('docks to the edge and alignment that settings name', () => {
    useSettingsStore.setState({
      settings: { ...baseSettings, taskbarPosition: 'left', taskbarAlignment: 'start' },
    });
    const { container } = render(<Taskbar />);
    const bar = container.querySelector('.aura-taskbar')!;
    expect(bar.getAttribute('data-position')).toBe('left');
    expect(bar.getAttribute('data-align')).toBe('start');
  });

  it('renders nothing when the user has hidden it', () => {
    useSettingsStore.setState({ settings: { ...baseSettings, taskbarVisible: false } });
    const { container } = render(<Taskbar />);
    expect(container.firstChild).toBeNull();
  });

  it('from another screen, goes to the desktop and shows the window rather than minimising it', async () => {
    const { useUiStore } = await import('@/store');
    // Focused, so a plain toggle would minimise it - the case this guards.
    const id = openWindow('Games', 'f1');
    useUiStore.setState({ screen: 'games' });

    render(<Taskbar />);
    fireEvent.click(screen.getByLabelText('Games'));

    expect(useUiStore.getState().screen).toBe('home');
    expect(wm().windows.find((w) => w.id === id)!.mode).toBe('normal');
    expect(wm().focusedId).toBe(id);
    useUiStore.setState({ screen: 'home' });
  });
});
