/**
 * The window layer as it actually mounts.
 *
 * Geometry and state have their own unit tests; what is only observable here is the wiring -
 * which windows render, whether the focus *scope* follows the focused window (the answer to
 * overlapping windows, docs/RISKS.md R11), and whether the title-bar controls do their job.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const setScope = vi.fn();

// The real engine is tested separately. This stub only has to expose `setScope` and make the
// focusable controls clickable, which is exactly the surface the layer touches.
vi.mock('@/focus', () => ({
  useFocus: () => ({ setScope }),
  useFocusable: (options: { onActivate?: () => void }) => ({
    ref: () => {},
    focused: false,
    props: { tabIndex: -1, onClick: () => options.onActivate?.() },
  }),
}));
vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ settings: { reduceMotion: true } }),
}));

const { WindowLayer } = await import('./WindowLayer');
const { resetWm, useWmStore } = await import('./store');

const wm = () => useWmStore.getState();

beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => {
  vi.clearAllMocks();
  resetWm();
});

const renderers = { folder: (w: { title: string }) => <p>body of {w.title}</p> };

describe('WindowLayer', () => {
  it('renders an open window with its body, and not a minimised one', () => {
    const games = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    wm().open({ kind: 'folder', targetId: 'f2', title: 'Apps' });
    wm().minimise(games);

    render(<WindowLayer renderers={renderers} />);

    expect(screen.getByLabelText('Apps')).toBeDefined();
    expect(screen.getByText('body of Apps')).toBeDefined();
    expect(screen.queryByLabelText('Games')).toBeNull();
  });

  it('falls back to a placeholder for a kind nothing renders yet', () => {
    wm().open({ kind: 'settings', title: 'Settings' });
    render(<WindowLayer renderers={renderers} />);

    expect(screen.getByText(/nothing renders a settings window yet/i)).toBeDefined();
  });

  it('scopes focus to the focused window, and releases it when none is', () => {
    const id = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    render(<WindowLayer renderers={renderers} />);

    expect(setScope).toHaveBeenLastCalledWith(`window:${id}`);

    // Back to the desktop: directional navigation has to reach the icons and nav bar again.
    act(() => wm().blurAll());
    expect(setScope).toHaveBeenLastCalledWith(null);
  });

  it('closes and minimises from the title bar', () => {
    const id = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    render(<WindowLayer renderers={renderers} />);

    fireEvent.click(screen.getByLabelText('Minimise'));
    expect(wm().windows.find((w) => w.id === id)!.mode).toBe('minimised');
    expect(wm().minimiseHint?.id).toBe(id);
  });

  it('maximises on a double-click of the title bar and back again', () => {
    const id = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    render(<WindowLayer renderers={renderers} />);

    const title = screen.getByLabelText('Games').querySelector('.aura-window-title')!;
    fireEvent.doubleClick(title);
    expect(wm().windows.find((w) => w.id === id)!.mode).toBe('maximised');

    fireEvent.doubleClick(title);
    expect(wm().windows.find((w) => w.id === id)!.mode).toBe('normal');
  });

  it('raises a background window when it is clicked anywhere', () => {
    const first = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    wm().open({ kind: 'folder', targetId: 'f2', title: 'Apps' });
    expect(wm().focusedId).not.toBe(first);

    render(<WindowLayer renderers={renderers} />);
    fireEvent.pointerDown(screen.getByText('body of Games'), { button: 0, pointerId: 1 });

    expect(wm().focusedId).toBe(first);
  });
});
