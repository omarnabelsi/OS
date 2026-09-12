/**
 * The answer to overlapping windows: scope, not cleverer geometry.
 *
 * `src/focus/geometry.ts` assumes a flat surface. Two windows side by side break that assumption
 * completely - a tile in the background window is genuinely "to the right of" one in the
 * foreground, and the spatial engine will happily go there. This is the test that the scope
 * mechanism stops it, and the first assertion below deliberately proves the escape *would*
 * happen without it, so the rest is not testing a tautology.
 *
 * Moving between windows is a separate action (`nextWindow` / `prevWindow`); directional
 * movement is never asked to walk out of a window (docs/RISKS.md R4, R11).
 */

import { act, render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { FocusProvider, useFocus, useFocusable, type FocusContextValue } from '@/focus/FocusProvider';

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.rect ?? '0,0,0,0').split(',').map(Number);
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} } as DOMRect;
  };
  HTMLElement.prototype.scrollIntoView = () => {};
});

function Focusable({ id, group, rect }: { id: string; group: string; rect: string }): React.JSX.Element {
  const { ref, props } = useFocusable({ id, group });
  return <button ref={ref as React.Ref<HTMLButtonElement>} type="button" data-rect={rect} {...props} />;
}

let engine: FocusContextValue;
function Grab(): null {
  engine = useFocus();
  return null;
}

/**
 * Two windows, side by side, each with two tiles in a row - plus the desktop behind them.
 *
 * `window:2`'s tiles sit directly to the right of `window:1`'s, which is exactly the arrangement
 * that fools a spatial engine.
 */
function renderTwoWindows() {
  return render(
    <FocusProvider>
      <Grab />
      <Focusable id="desktop:games" group="desktop" rect="0,600,200,150" />
      <Focusable id="window:1:tile-a" group="window:1" rect="100,100,180,260" />
      <Focusable id="window:1:tile-b" group="window:1" rect="300,100,180,260" />
      <Focusable id="window:1:close" group="window:1" rect="420,40,40,40" />
      <Focusable id="window:2:tile-a" group="window:2" rect="700,100,180,260" />
      <Focusable id="window:2:tile-b" group="window:2" rect="900,100,180,260" />
    </FocusProvider>,
  );
}

describe('window focus scope', () => {
  it('would let focus walk into a background window with no scope set', () => {
    renderTwoWindows();
    act(() => {
      engine.focus('window:1:tile-b');
    });
    act(() => {
      engine.move('right');
    });
    // The geometry is not wrong - `window:2`'s tile really is the nearest thing to the right.
    expect(engine.focusedId).toBe('window:2:tile-a');
  });

  it('never escapes the focused window once it owns the scope', () => {
    renderTwoWindows();
    act(() => {
      engine.setScope('window:1');
    });
    act(() => {
      engine.focus('window:1:tile-b');
    });

    // Press right into the other window, repeatedly, from every edge of this one.
    for (const direction of ['right', 'right', 'down', 'up', 'left', 'left', 'left'] as const) {
      act(() => {
        engine.move(direction);
      });
      expect(engine.focusedId?.startsWith('window:1')).toBe(true);
    }
  });

  it('still reaches the window’s own controls', () => {
    renderTwoWindows();
    act(() => {
      engine.setScope('window:1');
    });
    act(() => {
      engine.focus('window:1:tile-b');
    });
    act(() => {
      engine.move('up');
    });
    expect(engine.focusedId).toBe('window:1:close');
  });

  it('cannot reach the desktop while a window holds the scope', () => {
    renderTwoWindows();
    act(() => {
      engine.setScope('window:1');
    });
    act(() => {
      engine.focus('window:1:tile-a');
    });
    for (let i = 0; i < 4; i++) {
      act(() => {
        engine.move('down');
      });
    }
    expect(engine.focusedId?.startsWith('window:1')).toBe(true);
  });

  it('hands the desktop back when the scope is cleared', () => {
    renderTwoWindows();
    act(() => {
      engine.setScope('window:1');
    });
    act(() => {
      engine.focus('window:1:tile-a');
    });
    act(() => {
      engine.setScope(null);
    });
    act(() => {
      engine.move('down');
    });
    expect(engine.focusedId).toBe('desktop:games');
  });
});
