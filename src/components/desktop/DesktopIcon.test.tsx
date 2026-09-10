/**
 * The press-versus-drag gesture.
 *
 * The interesting behaviour is the threshold: a press that wanders a pixel is a click (open the
 * folder), a press that travels is a drag (move it), and a drag must *not* also open the thing
 * when the pointer comes up. Getting that wrong means every drag opens a window.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopItem, Folder } from '@/bridge';

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});

// The focus engine has its own tests; this stub only has to behave like it where the gesture
// touches it - which means `props.onClick` activating, exactly as `useFocusable` does.
vi.mock('@/focus', () => ({
  useFocusable: (options: { onActivate?: () => void }) => ({
    ref: () => {},
    focused: false,
    props: {
      'data-focused': undefined,
      tabIndex: -1,
      onMouseEnter: () => {},
      onClick: () => options.onActivate?.(),
    },
  }),
}));
vi.mock('@/theme', () => ({
  useTheme: () => ({ bundle: null, loading: false, error: null, focusScale: 1.08, reload: async () => {} }),
}));

const { DesktopIcon, DRAG_THRESHOLD_PX } = await import('./DesktopIcon');

beforeAll(() => {
  // jsdom has no pointer capture; the component only needs the calls not to throw.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

const item: DesktopItem = {
  id: 'i1',
  desktopId: 'd1',
  kind: 'folder',
  targetId: 'f1',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  labelOverride: null,
  iconOverride: null,
  sortOrder: 0,
};

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

function setup() {
  const handlers = {
    onActivate: vi.fn(),
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
  };
  render(
    <DesktopIcon item={item} folder={folder} entry={undefined} dragOffset={null} {...handlers} />,
  );
  return { ...handlers, button: screen.getByRole('button') };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DesktopIcon gesture', () => {
  it('shows the folder label', () => {
    setup();
    expect(screen.getByText('Games')).toBeDefined();
  });

  it('treats a press that barely moves as a click, not a drag', () => {
    const { button, onActivate, onDragStart } = setup();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100 });
    fireEvent.click(button);

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('becomes a drag past the threshold and reports offsets', () => {
    const { button, onDragStart, onDragMove, onDragEnd } = setup();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 140, clientY: 130 });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenLastCalledWith(40, 30);

    fireEvent.pointerMove(button, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(onDragMove).toHaveBeenLastCalledWith(60, 0);

    fireEvent.pointerUp(button, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('does not open the folder when the drag ends - the click is the end of the gesture', () => {
    const { button, onActivate } = setup();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 200, clientY: 200 });
    // The browser fires this after any pointerup on a button.
    fireEvent.click(button);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('opens normally on the click after a drag has finished', () => {
    const { button, onActivate } = setup();

    // Drag once...
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();

    // ...then a plain click must still work, or the icon is dead after its first move.
    fireEvent.pointerDown(button, { button: 0, pointerId: 2, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 60, clientY: 60 });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('ignores a right-click press, which belongs to the context menu', () => {
    const { button, onDragStart } = setup();
    fireEvent.pointerDown(button, { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
