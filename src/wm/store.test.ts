import { beforeEach, describe, expect, it } from 'vitest';

import { resetWm, useWmStore, visibleWindows } from './store';

const wm = () => useWmStore.getState();
const bounds = { x: 0, y: 72, width: 1366, height: 696 };

beforeEach(() => {
  resetWm();
  wm().setBounds(bounds);
});

function openFolder(title: string, targetId: string) {
  return wm().open({ kind: 'folder', targetId, title });
}

describe('open', () => {
  it('opens a window, focuses it, and places it inside the desktop', () => {
    const id = openFolder('Games', 'f1');
    const w = wm().windows.find((x) => x.id === id)!;

    expect(wm().focusedId).toBe(id);
    expect(w.title).toBe('Games');
    expect(w.rect.x).toBeGreaterThanOrEqual(bounds.x);
    expect(w.rect.y).toBeGreaterThanOrEqual(bounds.y);
  });

  it('raises the existing window instead of stacking a duplicate', () => {
    const first = openFolder('Games', 'f1');
    openFolder('Apps', 'f2');

    const again = wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    expect(again).toBe(first);
    expect(wm().windows).toHaveLength(2);
    expect(wm().focusedId).toBe(first);
    // ...and it is on top now.
    const top = [...wm().windows].sort((a, b) => b.zIndex - a.zIndex)[0]!;
    expect(top.id).toBe(first);
  });

  it('un-minimises when the same target is opened again', () => {
    const id = openFolder('Games', 'f1');
    wm().minimise(id);
    expect(wm().windows[0]!.mode).toBe('minimised');

    wm().open({ kind: 'folder', targetId: 'f1', title: 'Games' });
    expect(wm().windows[0]!.mode).toBe('normal');
    expect(wm().focusedId).toBe(id);
  });

  it('cascades so a second window does not hide the first', () => {
    const aId = openFolder('A', 'f1');
    const a = { ...wm().windows.find((w) => w.id === aId)!.rect };
    const bId = openFolder('B', 'f2');
    const b = wm().windows.find((w) => w.id === bId)!.rect;
    expect([b.x, b.y]).not.toEqual([a.x, a.y]);
  });
});

describe('z-order', () => {
  it('puts the focused window on top and keeps the rest in order', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    const c = openFolder('C', 'f3');

    wm().focus(a);
    const order = [...wm().windows].sort((x, y) => x.zIndex - y.zIndex).map((w) => w.id);
    expect(order).toEqual([b, c, a]);
  });

  it('does not let z-indices climb forever', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    for (let i = 0; i < 50; i++) {
      wm().focus(i % 2 === 0 ? a : b);
    }
    // Restacking renumbers from a fixed base rather than incrementing.
    expect(Math.max(...wm().windows.map((w) => w.zIndex))).toBeLessThan(200);
  });

  it('ignores a focus request for a window that is gone', () => {
    openFolder('A', 'f1');
    wm().focus('nope');
    expect(wm().focusedId).not.toBe('nope');
  });
});

describe('close and minimise', () => {
  it('hands focus to the next window down, not to nothing', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    expect(wm().focusedId).toBe(b);

    wm().close(b);
    expect(wm().focusedId).toBe(a);
  });

  it('returns focus to the desktop when the last window closes', () => {
    const a = openFolder('A', 'f1');
    wm().close(a);
    expect(wm().windows).toHaveLength(0);
    expect(wm().focusedId).toBeNull();
  });

  it('minimising hands focus on without destroying the window', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');

    wm().minimise(b);
    expect(wm().windows).toHaveLength(2);
    expect(wm().focusedId).toBe(a);
    expect(visibleWindows(wm().windows).map((w) => w.id)).toEqual([a]);
  });

  it('minimising the only window returns focus to the desktop', () => {
    const a = openFolder('A', 'f1');
    wm().minimise(a);
    expect(wm().focusedId).toBeNull();
  });
});

describe('maximise', () => {
  it('keeps the normal geometry to come back to', () => {
    const id = openFolder('A', 'f1');
    const before = { ...wm().windows[0]!.rect };

    wm().toggleMaximise(id);
    expect(wm().windows[0]!.mode).toBe('maximised');
    // The stored rect is untouched - that is what restore uses.
    expect(wm().windows[0]!.rect).toEqual(before);

    wm().toggleMaximise(id);
    expect(wm().windows[0]!.mode).toBe('normal');
    expect(wm().windows[0]!.rect).toEqual(before);
  });
});

describe('move and resize', () => {
  it('constrains a window dragged off the desktop', () => {
    const id = openFolder('A', 'f1');
    wm().move(id, { x: -9999, y: -9999, width: 600, height: 400 });

    const rect = wm().windows[0]!.rect;
    expect(rect.y).toBe(bounds.y);
    expect(rect.x + rect.width).toBeGreaterThan(bounds.x);
  });

  it('refuses a resize below the usable minimum', () => {
    const id = openFolder('A', 'f1');
    wm().resize(id, { x: 100, y: 100, width: 10, height: 10 });
    const rect = wm().windows[0]!.rect;
    expect(rect.width).toBeGreaterThanOrEqual(320);
    expect(rect.height).toBeGreaterThanOrEqual(200);
  });
});

describe('snap', () => {
  it('halves the desktop', () => {
    const id = openFolder('A', 'f1');
    wm().applySnap(id, 'left');
    expect(wm().windows[0]!.rect).toEqual({
      x: bounds.x,
      y: bounds.y,
      width: Math.round(bounds.width / 2),
      height: bounds.height,
    });
  });

  it('snapping to the top maximises rather than resizing', () => {
    const id = openFolder('A', 'f1');
    const before = { ...wm().windows[0]!.rect };
    wm().applySnap(id, 'maximise');
    expect(wm().windows[0]!.mode).toBe('maximised');
    expect(wm().windows[0]!.rect).toEqual(before);
  });

  it('un-maximises when snapped to a half', () => {
    const id = openFolder('A', 'f1');
    wm().toggleMaximise(id);
    wm().applySnap(id, 'right');
    expect(wm().windows[0]!.mode).toBe('normal');
  });

  it('clears the preview once applied', () => {
    const id = openFolder('A', 'f1');
    wm().setSnapPreview('left');
    expect(wm().snapPreview).toBe('left');
    wm().applySnap(id, 'left');
    expect(wm().snapPreview).toBeNull();
  });
});

describe('setBounds', () => {
  it('keeps windows reachable when the desktop shrinks', () => {
    const id = openFolder('A', 'f1');
    wm().move(id, { x: 1200, y: 600, width: 600, height: 400 });

    wm().setBounds({ x: 0, y: 72, width: 640, height: 400 });
    const rect = wm().windows[0]!.rect;
    expect(rect.x).toBeLessThanOrEqual(640 - 96);
    expect(rect.y).toBeLessThanOrEqual(72 + 400 - 96);
  });

  it('does nothing when the bounds have not actually changed', () => {
    openFolder('A', 'f1');
    const before = wm().windows;
    wm().setBounds({ ...bounds });
    expect(wm().windows).toBe(before);
  });
});

describe('focusNext', () => {
  it('cycles through the open windows in both directions', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    const c = openFolder('C', 'f3');
    // c is focused and on top; the stack from the bottom is a, b, c.

    wm().focusNext(1);
    expect(wm().focusedId).toBe(a);
    wm().focusNext(-1);
    expect(wm().focusedId).toBe(c);
    expect([a, b, c]).toContain(wm().focusedId);
  });

  it('skips minimised windows - you cannot switch to something not on screen', () => {
    const a = openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    wm().minimise(b);

    wm().focusNext(1);
    expect(wm().focusedId).toBe(a);
    wm().focusNext(1);
    expect(wm().focusedId).toBe(a);
  });

  it('steps onto the topmost window when coming from the desktop', () => {
    openFolder('A', 'f1');
    const b = openFolder('B', 'f2');
    wm().blurAll();
    expect(wm().focusedId).toBeNull();

    wm().focusNext(1);
    expect(wm().focusedId).toBe(b);
  });

  it('does nothing when there is nothing to switch to', () => {
    wm().focusNext(1);
    expect(wm().focusedId).toBeNull();
  });
});

describe('toggleFromTaskbar', () => {
  it('focuses, then minimises, then restores - what a taskbar button does', () => {
    const a = openFolder('A', 'f1');
    openFolder('B', 'f2');

    wm().toggleFromTaskbar(a);
    expect(wm().focusedId).toBe(a);

    wm().toggleFromTaskbar(a);
    expect(wm().windows.find((w) => w.id === a)!.mode).toBe('minimised');

    wm().toggleFromTaskbar(a);
    expect(wm().windows.find((w) => w.id === a)!.mode).toBe('normal');
    expect(wm().focusedId).toBe(a);
  });
});

describe('minimise hint', () => {
  it('aims at the bottom centre of the desktop when no taskbar has registered a button', () => {
    const id = openFolder('A', 'f1');
    wm().minimise(id);

    expect(wm().minimiseHint).toEqual({
      id,
      point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
    });
  });

  it('aims at the registered taskbar button when there is one', () => {
    const id = openFolder('A', 'f1');
    wm().setMinimiseAnchor(id, { x: 240, y: 1040 });
    wm().minimise(id);

    expect(wm().minimiseHint).toEqual({ id, point: { x: 240, y: 1040 } });
  });

  it('is cleared on restore, so a later close does not fly to the taskbar', () => {
    const id = openFolder('A', 'f1');
    wm().minimise(id);
    wm().restore(id);
    expect(wm().minimiseHint).toBeNull();

    wm().close(id);
    expect(wm().minimiseHint).toBeNull();
  });

  it('drops a closed window’s anchor rather than leaking it to the next window', () => {
    const id = openFolder('A', 'f1');
    wm().setMinimiseAnchor(id, { x: 10, y: 20 });
    wm().close(id);

    expect(wm().minimiseAnchors).toEqual({});
  });

  it('ignores a minimise for a window that is not open', () => {
    wm().minimise('win-nope');
    expect(wm().minimiseHint).toBeNull();
  });
});

describe('opening at a preferred size', () => {
  it('pulls the window back so all of it fits, rather than hanging off the bottom', () => {
    // A few windows first, so the cascade has walked well down the desktop.
    ['a', 'b', 'c', 'd'].forEach((title, i) => openFolder(title, `f${i}`));

    const id = wm().open({ kind: 'settings', title: 'Settings', size: { width: 760, height: 560 } });
    const w = wm().windows.find((x) => x.id === id)!;

    // Hanging off the edge made the browser scroll the desktop to reveal a focused control.
    expect(w.rect.y + w.rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    expect(w.rect.x + w.rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(w.rect.width).toBe(760);
    expect(w.rect.height).toBe(560);
  });

  it('caps a size larger than the desktop to the desktop', () => {
    const id = wm().open({ kind: 'settings', title: 'Settings', size: { width: 5000, height: 5000 } });
    expect(wm().windows.find((x) => x.id === id)!.rect).toEqual(bounds);
  });
});
