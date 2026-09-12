/**
 * Fullscreen and maximise from the UI side: both go through the host, and the UI's copies of
 * the window state and the settings are brought back in line afterwards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/bridge', async () => {
  const helpers = await import('./test-helpers');
  return helpers.fakeBridgeModule();
});

const { fakeApi, resetFakeApi } = await import('./test-helpers');
const { toggleShellFullscreen, toggleShellMaximize, useShellWindow } = await import('./shellWindow');

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  useShellWindow.setState({ state: null });
});

describe('toggleShellFullscreen', () => {
  it('leaves fullscreen when fullscreen, and re-reads settings so the Fullscreen row is current', async () => {
    useShellWindow.setState({ state: { fullscreen: true, maximized: false, minimized: false } });

    await toggleShellFullscreen();

    expect(fakeApi.setFullscreen).toHaveBeenCalledWith(false);
    // The host persisted the preference; Settings must not keep showing the old value.
    expect(fakeApi.getSettings).toHaveBeenCalled();
  });

  it('asks the host for the current state when it does not know it yet', async () => {
    fakeApi.getWindowState.mockResolvedValue({ fullscreen: false, maximized: false, minimized: false });

    await toggleShellFullscreen();

    expect(fakeApi.setFullscreen).toHaveBeenCalledWith(true);
  });
});

describe('toggleShellMaximize', () => {
  it('keeps whatever the host reports afterwards', async () => {
    await toggleShellMaximize();
    expect(fakeApi.toggleMaximizeShell).toHaveBeenCalledTimes(1);
    expect(useShellWindow.getState().state).toEqual({ fullscreen: false, maximized: true, minimized: false });
  });
});
