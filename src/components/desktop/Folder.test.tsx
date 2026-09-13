/**
 * The folder as it actually mounts.
 *
 * The geometry maths and the sanitising have their own tests. What is only observable here is the
 * wiring: that a theme's declared shape reaches the DOM as geometry, that a tint and a cover
 * change the fill rather than being ignored, that focus produces all four of its signals at once,
 * and that a drag does not also count as an open.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopItem, Folder as FolderRecord, ThemeFolderShape } from '@/bridge';

const SHAPES: ThemeFolderShape[] = [
  { id: 'rounded', asset: 'assets/folders/rounded.svg', height: 152, radius: '28px' },
  { id: 'capsule', asset: 'assets/folders/capsule.svg', height: 104, radius: '56px', offsetTop: 24 },
  {
    id: 'tab',
    asset: 'assets/folders/tab.svg',
    height: 152,
    radius: '6px 28px 28px 28px',
    tab: { width: 84, height: 16, radius: '10px 10px 0 0' },
  },
];

/** Which focusable id is currently focused, so the focus signals can be asserted. */
let focusedId: string | null = null;

// The real engine is tested separately. This stub exposes just the surface the folder touches.
vi.mock('@/focus', () => ({
  useFocusable: (options: { id: string; onActivate?: () => void }) => ({
    ref: () => {},
    focused: focusedId === options.id,
    // Tests here model D-pad focus, which is the focus a folder draws - see `FocusSource`.
    visible: focusedId === options.id,
    props: {
      'data-focused': focusedId === options.id ? true : undefined,
      tabIndex: -1,
      onMouseEnter: () => {},
      onClick: () => options.onActivate?.(),
    },
  }),
}));

vi.mock('@/theme', () => ({
  useTheme: () => ({
    bundle: { layout: { folderShapes: SHAPES }, assetsDir: 'C:/themes/aura-default/assets' },
  }),
}));

const { Folder } = await import('./Folder');
const { resetBudget } = await import('@/surface');

beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => {
  focusedId = null;
  resetBudget();
});

function item(overrides: Partial<DesktopItem> = {}): DesktopItem {
  return {
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
    ...overrides,
  };
}

function folder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
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
    ...overrides,
  };
}

const noop = () => {};

function renderFolder(
  props: Partial<React.ComponentProps<typeof Folder>> = {},
): { onActivate: ReturnType<typeof vi.fn>; root: HTMLElement } {
  const onActivate = vi.fn();
  render(
    <Folder
      item={item()}
      folder={folder()}
      count={4}
      dragOffset={null}
      onActivate={onActivate}
      onDragStart={noop}
      onDragMove={noop}
      onDragEnd={noop}
      {...props}
    />,
  );
  return { onActivate, root: document.querySelector('.aura-folder') as HTMLElement };
}

describe('Folder', () => {
  it('shows the label and the item count', () => {
    renderFolder();
    expect(screen.getByText('Games')).toBeDefined();
    expect(screen.getByText('4 items')).toBeDefined();
  });

  it('says "1 item", not "1 items"', () => {
    renderFolder({ count: 1 });
    expect(screen.getByText('1 item')).toBeDefined();
  });

  it('reserves the meta line while the count is unknown', () => {
    // Blank rather than absent: the label must not jump when the count arrives.
    renderFolder({ count: null });
    expect(document.querySelector('.aura-folder-meta')?.textContent).toBe('\u00a0');
  });

  it("prefers the item's label override to the folder's name", () => {
    renderFolder({ item: item({ labelOverride: 'My Games' }) });
    expect(screen.getByText('My Games')).toBeDefined();
  });

  describe('shapes come from the theme', () => {
    it('applies the declared geometry as custom properties', () => {
      const { root } = renderFolder({ folder: folder({ shape: 'capsule' }) });
      const style = root.getAttribute('style') ?? '';
      expect(root.dataset.shape).toBe('capsule');
      expect(style).toContain('--folder-art-height: 104px');
      expect(style).toContain('--folder-art-radius: 56px');
      // The capsule's optical centring.
      expect(style).toContain('--folder-art-offset: 24px');
    });

    it('draws a tab only for a shape that declares one', () => {
      renderFolder({ folder: folder({ shape: 'tab' }) });
      expect(document.querySelector('.aura-folder-tab')).not.toBeNull();

      document.body.innerHTML = '';
      renderFolder({ folder: folder({ shape: 'rounded' }) });
      expect(document.querySelector('.aura-folder-tab')).toBeNull();
    });

    it("falls back to the theme's first shape for one it does not offer", () => {
      const { root } = renderFolder({ folder: folder({ shape: 'binder' }) });
      expect(root.dataset.shape).toBe('rounded');
    });
  });

  it('tints the fill when the folder has a colour', () => {
    const { root } = renderFolder({ folder: folder({ color: '#6ee7ff' }) });
    expect(root.dataset.tinted).toBe('true');
    expect(root.getAttribute('style')).toContain('--folder-tint: #6ee7ff');
  });

  it('takes a cover image, with a scrim to keep the icon readable', () => {
    const { root } = renderFolder({ folder: folder({ cover: 'C:/art/cover.jpg' }) });
    expect(root.dataset.covered).toBe('true');
    expect(document.querySelector('.aura-folder-cover')).not.toBeNull();
    expect(document.querySelector('.aura-folder-cover-scrim')).not.toBeNull();
  });

  it("draws a custom icon image, when `icon` is not one of the theme's names", () => {
    renderFolder({ folder: folder({ icon: 'C:/pics/icon.png' }) });
    const img = document.querySelector('.aura-folder-icon-image') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('C:/pics/icon.png');
    // Not run through the vector icon set - a bad name silently drawing nothing is the bug 11d
    // fixed, and this is what proves it stays fixed.
    expect(document.querySelector('.aura-folder-icon svg')).toBeNull();
  });

  it("still draws a known theme icon by name, not as an image", () => {
    renderFolder({ folder: folder({ icon: 'star' }) });
    expect(document.querySelector('.aura-folder-icon-image')).toBeNull();
    expect(document.querySelector('.aura-folder-icon svg')).not.toBeNull();
  });

  it('rises from e1 to e3 when focused', () => {
    renderFolder();
    expect(document.querySelector('.aura-folder-body')?.className).toContain('aura-surface-e1');

    document.body.innerHTML = '';
    focusedId = 'desktop:i1';
    renderFolder();
    const body = document.querySelector('.aura-folder-body');
    expect(body?.className).toContain('aura-surface-e3');
    // The wrapper carries the focus flag the stylesheet keys its four signals off.
    expect(document.querySelector('.aura-folder')?.getAttribute('data-focused')).toBe('true');
  });

  describe('press and drag', () => {
    it('opens on a click that did not move', () => {
      const { onActivate, root } = renderFolder();
      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(root, { pointerId: 1 });
      fireEvent.click(root);
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('does not open when the click is the end of a drag', () => {
      const onDragStart = vi.fn();
      const onDragMove = vi.fn();
      const { onActivate, root } = renderFolder({ onDragStart, onDragMove });

      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(root, { clientX: 60, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(root, { pointerId: 1 });
      fireEvent.click(root);

      expect(onDragStart).toHaveBeenCalledTimes(1);
      expect(onDragMove).toHaveBeenCalled();
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('marks itself pressed between press and release, and not while dragging', () => {
      const { root } = renderFolder();
      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      expect(root.dataset.pressed).toBe('true');

      fireEvent.pointerMove(root, { clientX: 80, clientY: 10, pointerId: 1 });
      // A drag is a different state from a press; the two must not both apply.
      expect(root.dataset.pressed).toBeUndefined();
      expect(root.dataset.dragging).toBe('true');
    });

    it('ignores a right-click press, which belongs to the context menu', () => {
      const onDragStart = vi.fn();
      const { root } = renderFolder({ onDragStart });
      fireEvent.pointerDown(root, { button: 2, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(root, { clientX: 90, clientY: 10, pointerId: 1 });
      expect(onDragStart).not.toHaveBeenCalled();
    });
  });
});
