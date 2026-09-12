/**
 * What placed focus, and whether it is shown.
 *
 * Measured in the running shell before this existed: on boot the engine focused the first folder
 * and dimmed every other one to 68%, with no input at all; and because hovering moves focus, a
 * mouse user never saw the folder's hover state or the taskbar's 400ms tooltip dwell - every hover
 * was a full focus. The engine now records the source, and `visible` is true only for D-pad or
 * keyboard focus.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { FocusProvider, useFocus, useFocusable, type FocusContextValue } from './FocusProvider';

beforeAll(() => {
  // jsdom lays nothing out; give each element the rect its `data-rect` names.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const [x = 0, y = 0, width = 0, height = 0] = (this.dataset.rect ?? '0,0,0,0').split(',').map(Number);
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} } as DOMRect;
  };
  HTMLElement.prototype.scrollIntoView = () => {};
});

function Item({ id, group, rect }: { id: string; group: string; rect: string }): React.JSX.Element {
  const { ref, visible, props } = useFocusable({ id, group });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      data-rect={rect}
      data-testid={id}
      data-visible={visible || undefined}
      {...props}
    />
  );
}

let engine: FocusContextValue;
function Grab(): null {
  engine = useFocus();
  return null;
}

function renderSurface(group: string) {
  return render(
    <FocusProvider>
      <Grab />
      <Item id={`${group}:a`} group={group} rect="0,0,100,100" />
      <Item id={`${group}:b`} group={group} rect="0,200,100,100" />
      <Item id="taskbar:home" group="taskbar" rect="400,600,50,50" />
    </FocusProvider>,
  );
}

const visible = (id: string) => screen.getByTestId(id).hasAttribute('data-visible');

describe('focus source', () => {
  it("keeps the engine's own first placement quiet", () => {
    renderSurface('desktop');
    expect(engine.focusedId).toBe('desktop:a');
    expect(engine.focusSource).toBe('auto');
    expect(visible('desktop:a')).toBe(false);
  });

  it('focuses on hover without drawing the focus, so the hover state can show', () => {
    renderSurface('desktop');
    fireEvent.pointerMove(window);
    fireEvent.mouseEnter(screen.getByTestId('desktop:b'));
    expect(engine.focusedId).toBe('desktop:b');
    expect(engine.focusSource).toBe('pointer');
    expect(visible('desktop:b')).toBe(false);
  });

  it('draws focus the D-pad placed', () => {
    renderSurface('desktop');
    act(() => {
      engine.move('down');
    });
    act(() => {
      engine.move('down');
    });
    expect(engine.focusedId).toBe('desktop:b');
    expect(engine.focusSource).toBe('nav');
    expect(visible('desktop:b')).toBe(true);
  });

  it('on the desktop, reveals an unseen focus on the first press instead of moving past it', () => {
    renderSurface('desktop');
    act(() => {
      engine.move('down');
    });
    // Still on the first folder - now shown - rather than having jumped to the second.
    expect(engine.focusedId).toBe('desktop:a');
    expect(visible('desktop:a')).toBe(true);
  });

  it('reveals the folder the pointer was resting on, not the one after it', () => {
    renderSurface('desktop');
    fireEvent.pointerMove(window);
    fireEvent.mouseEnter(screen.getByTestId('desktop:b'));
    act(() => {
      engine.move('up');
    });
    expect(engine.focusedId).toBe('desktop:b');
    expect(visible('desktop:b')).toBe(true);
  });

  it('moves on the first press everywhere else, where the automatic focus is already on show', () => {
    renderSurface('content');
    act(() => {
      engine.move('down');
    });
    expect(engine.focusedId).toBe('content:b');
  });

  it('treats a mouse click as the pointer and a keyboard-synthesised click as navigation', () => {
    renderSurface('desktop');
    fireEvent.click(screen.getByTestId('desktop:b'), { detail: 1 });
    expect(engine.focusSource).toBe('pointer');
    fireEvent.click(screen.getByTestId('desktop:a'), { detail: 0 });
    expect(engine.focusSource).toBe('nav');
    expect(visible('desktop:a')).toBe(true);
  });

  it("keeps focus that code moves on the user's behalf visible", () => {
    renderSurface('desktop');
    act(() => {
      engine.focus('desktop:b');
    });
    expect(engine.focusSource).toBe('nav');
  });

  it('shows an unseen focus even when the press has nowhere to go', () => {
    // The cursor resting on the taskbar, then Down on the pad: nothing is below the bar, and the
    // press used to do nothing at all - no move, no ring, no idea where focus was.
    renderSurface('content');
    fireEvent.pointerMove(window);
    fireEvent.mouseEnter(screen.getByTestId('taskbar:home'));
    expect(visible('taskbar:home')).toBe(false);

    let handled = false;
    act(() => {
      handled = engine.move('down');
    });
    expect(handled).toBe(true);
    expect(engine.focusedId).toBe('taskbar:home');
    expect(visible('taskbar:home')).toBe(true);
  });

  it('still reports a blocked press once the focus is already on show', () => {
    renderSurface('content');
    act(() => {
      engine.focus('taskbar:home');
    });
    let handled = true;
    act(() => {
      handled = engine.move('down');
    });
    expect(handled).toBe(false);
  });
});
