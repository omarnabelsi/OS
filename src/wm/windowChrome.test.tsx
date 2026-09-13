/**
 * The window's chrome: what the title bar carries, and that every control does its job.
 *
 * The geometry and the states are checked against `window.css` in `styles/window.node.test.ts`;
 * what is only observable here is the wiring - four buttons that work, a bar that is not a Tauri
 * drag region, and the growth origin reaching the DOM.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowInstance } from './store';

// The engine has its own tests; here a focusable only has to be clickable.
vi.mock('@/focus', () => ({
  useFocusable: (options: { onActivate?: () => void }) => ({
    ref: () => {},
    focused: false,
    visible: false,
    props: { tabIndex: -1, onClick: () => options.onActivate?.() },
  }),
}));
vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => selector({ settings: { reduceMotion: true } }),
}));

const { Window } = await import('./Window');
const { resetWm, useWmStore } = await import('./store');

const wm = () => useWmStore.getState();

const BOUNDS = { x: 0, y: 60, width: 1920, height: 900 };

function open(overrides: Partial<WindowInstance> = {}): WindowInstance {
  const instance: WindowInstance = {
    id: 'win-1',
    kind: 'folder',
    targetId: 'f1',
    title: 'Games',
    subtitle: 'Smart folder',
    icon: 'games',
    iconColor: null,
    rect: { x: 200, y: 140, width: 1300, height: 790 },
    mode: 'normal',
    zIndex: 100,
    resizable: true,
    origin: null,
    ...overrides,
  };
  useWmStore.setState({ windows: [instance], focusedId: instance.id, bounds: BOUNDS });
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWm();
});

describe('window chrome', () => {
  it('carries the title, the subtitle and the folder icon', () => {
    const instance = open();
    const { container } = render(<Window window={instance}>body</Window>);

    expect(screen.getByText('Games')).toBeDefined();
    expect(screen.getByText('Smart folder')).toBeDefined();
    expect(container.querySelector('.aura-window-icon')).not.toBeNull();
    expect(container.querySelector('.aura-window-title-divider')).not.toBeNull();
  });

  it('says nothing where there is nothing to say', () => {
    const instance = open({ subtitle: null });
    const { container } = render(<Window window={instance}>body</Window>);
    expect(container.querySelector('.aura-window-subtitle')).toBeNull();
  });

  it("leaves the title bar icon uncoloured for a folder nobody tinted", () => {
    const instance = open({ iconColor: null });
    const { container } = render(<Window window={instance}>body</Window>);
    // No inline colour at all - the CSS default (ink) applies, not a hardcoded accent (11a).
    expect(container.querySelector('.aura-window-icon')?.getAttribute('style')).toBeFalsy();
  });

  it("shows the folder's own tint on the title bar icon, whatever colour that is", () => {
    const instance = open({ iconColor: '#b48cff' });
    const { container } = render(<Window window={instance}>body</Window>);
    const style = container.querySelector('.aura-window-icon')?.getAttribute('style') ?? '';
    expect(style.replace(/\s+/g, '')).toContain('--window-icon-tint:#b48cff');
  });

  it('gives the bar four buttons: back, minimise, maximise and close', () => {
    const instance = open();
    render(<Window window={instance}>body</Window>);
    for (const name of ['Back to the desktop', 'Minimise', 'Maximise', 'Close']) {
      expect(screen.getByLabelText(name)).toBeDefined();
    }
  });

  it('closes on the back chevron, which is the way out a folder window needs', () => {
    const instance = open();
    render(<Window window={instance}>body</Window>);
    fireEvent.click(screen.getByLabelText('Back to the desktop'));
    expect(wm().windows).toHaveLength(0);
  });

  it('minimises, maximises and closes from the controls', () => {
    const instance = open();
    render(<Window window={instance}>body</Window>);

    fireEvent.click(screen.getByLabelText('Maximise'));
    expect(wm().windows[0]?.mode).toBe('maximised');

    fireEvent.click(screen.getByLabelText('Minimise'));
    expect(wm().windows[0]?.mode).toBe('minimised');

    fireEvent.click(screen.getByLabelText('Close'));
    expect(wm().windows).toHaveLength(0);
  });

  it('drops the maximise control on a window that cannot be resized', () => {
    const instance = open({ resizable: false });
    render(<Window window={instance}>body</Window>);
    expect(screen.queryByLabelText('Maximise')).toBeNull();
    expect(screen.getByLabelText('Close')).toBeDefined();
  });

  it('is not a Tauri drag region', () => {
    /*
     * A window here is a DOM element inside the one webview. `data-tauri-drag-region` would hand
     * the gesture to the OS and drag the whole shell instead - and a drag region also swallows
     * presses on its children, which is how the controls died once already. It belongs on the
     * shell's own title bar, and only there.
     */
    const instance = open();
    const { container } = render(<Window window={instance}>body</Window>);
    expect(container.querySelectorAll('[data-tauri-drag-region]')).toHaveLength(0);
  });

  it('grows from the point it was opened at', () => {
    // The folder's centre, in viewport pixels, becomes the transform origin relative to the
    // window's own box - so the open animation expands out of that folder.
    const instance = open({ origin: { x: 300, y: 240 } });
    const { container } = render(<Window window={instance}>body</Window>);
    const box = container.querySelector('.aura-window') as HTMLElement;
    expect(box.style.transformOrigin).toBe('100px 100px');
  });

  it('grows from its own centre when nothing said otherwise', () => {
    const instance = open({ origin: null });
    const { container } = render(<Window window={instance}>body</Window>);
    const box = container.querySelector('.aura-window') as HTMLElement;
    expect(box.style.transformOrigin).toBe('center center');
  });
});
