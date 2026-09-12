/**
 * The shell's title bar: when it is drawn, and that its buttons go where they should.
 *
 * Everything here goes through the bridge. The point of that design is that it can be tested
 * like this at all - a title bar calling `@tauri-apps/api/window` directly could not be.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { fakeApi, resetFakeApi } = await import('@/store/test-helpers');
const { useUiStore } = await import('@/store');
const { useShellWindow } = await import('@/store/shellWindow');
const { ShellTitleBar } = await import('./ShellTitleBar');

const windowed = { fullscreen: false, maximized: false, minimized: false };

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  useShellWindow.setState({ state: null });
  useUiStore.setState({ overlay: null });
});

async function mount() {
  const view = render(<ShellTitleBar />);
  // Let the first window-state read land.
  await act(async () => {});
  return view;
}

describe('ShellTitleBar', () => {
  it('draws nothing while the shell is fullscreen - the default has no chrome at all', async () => {
    fakeApi.getWindowState.mockResolvedValue({ ...windowed, fullscreen: true });
    const { container } = await mount();
    expect(container.firstChild).toBeNull();
  });

  it('draws nothing before the host has answered, rather than flashing a bar', () => {
    fakeApi.getWindowState.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ShellTitleBar />);
    expect(container.firstChild).toBeNull();
  });

  it('minimises through the host', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Minimise'));
    expect(fakeApi.minimizeShell).toHaveBeenCalledTimes(1);
  });

  it('maximises through the host - never fullscreen - and then offers restore', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Maximise'));
    await act(async () => {});

    expect(fakeApi.toggleMaximizeShell).toHaveBeenCalledTimes(1);
    expect(fakeApi.setFullscreen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Restore')).toBeDefined();
  });

  it('close asks first: it opens the exit confirmation and never exits by itself', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(useUiStore.getState().overlay).toBe('exit');
    expect(fakeApi.exitShell).not.toHaveBeenCalled();
  });

  it('is a drag region on the bar and its label, but never on a button', async () => {
    const { container } = await mount();
    expect(container.querySelector('.aura-titlebar')!.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(container.querySelector('.aura-titlebar-name')!.hasAttribute('data-tauri-drag-region')).toBe(true);
    // A drag region swallows presses on whatever carries it.
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button.hasAttribute('data-tauri-drag-region')).toBe(false);
  });

  it('goes away when the window goes fullscreen, and comes back when it leaves', async () => {
    const { container } = await mount();
    expect(container.querySelector('.aura-titlebar')).not.toBeNull();

    fakeApi.getWindowState.mockResolvedValue({ ...windowed, fullscreen: true });
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(container.querySelector('.aura-titlebar')).toBeNull());

    fakeApi.getWindowState.mockResolvedValue(windowed);
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(container.querySelector('.aura-titlebar')).not.toBeNull());
  });
});
