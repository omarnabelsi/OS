/**
 * `<Surface>` as it actually mounts.
 *
 * The budget has its own unit tests; what is only observable here is that React components
 * claiming and releasing slots produce the right `data-blur` on the right elements - including
 * the acceptance criterion that a third window does not create a fourth blurred surface.
 */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetBudget, setMode } from './budget';
import { Surface } from './Surface';

beforeEach(() => {
  resetBudget();
});

const live = () => document.querySelectorAll('[data-blur="live"]');

describe('Surface', () => {
  it('carries its level as a class', () => {
    render(
      <Surface level="e2" className="aura-taskbar">
        bar
      </Surface>,
    );
    const el = screen.getByText('bar');
    expect(el.className).toContain('aura-surface');
    expect(el.className).toContain('aura-surface-e2');
    expect(el.className).toContain('aura-taskbar');
  });

  it('renders the element it is told to', () => {
    render(
      <Surface level="e4" as="section" aria-label="panel">
        body
      </Surface>,
    );
    expect(screen.getByLabelText('panel').tagName).toBe('SECTION');
  });

  it('never lets more than three surfaces blur at once', () => {
    render(
      <>
        <Surface level="e2" data-testid="taskbar" />
        <Surface level="e3" blur data-testid="window-1" />
        <Surface level="e4" data-testid="overlay" />
        <Surface level="e1" data-testid="item" />
      </>,
    );

    expect(live()).toHaveLength(3);
    expect(screen.getByTestId('item').getAttribute('data-blur')).toBe('off');
  });

  it('keeps a stack of windows down to one blurred surface', () => {
    // Three windows open, one focused. The other two pass `blur={false}` and never ask.
    render(
      <>
        <Surface level="e2" data-testid="taskbar" />
        <Surface level="e3" blur={false} data-testid="window-1" />
        <Surface level="e3" blur={false} data-testid="window-2" />
        <Surface level="e3" blur data-testid="window-3" />
      </>,
    );

    expect(live()).toHaveLength(2);
    expect(screen.getByTestId('window-3').getAttribute('data-blur')).toBe('live');
    expect(screen.getByTestId('window-2').getAttribute('data-blur')).toBe('off');
  });

  it('frees its slot when it unmounts', () => {
    const { rerender } = render(
      <>
        <Surface level="e4" data-testid="overlay" />
        <Surface level="e2" data-testid="taskbar" />
        <Surface level="e3" blur data-testid="window" />
        <Surface level="e1" data-testid="item" />
      </>,
    );
    expect(screen.getByTestId('item').getAttribute('data-blur')).toBe('off');

    rerender(
      <>
        <Surface level="e2" data-testid="taskbar" />
        <Surface level="e3" blur data-testid="window" />
        <Surface level="e1" data-testid="item" />
      </>,
    );
    expect(screen.getByTestId('item').getAttribute('data-blur')).toBe('live');
  });

  it('follows the mode when the engine changes it', () => {
    render(
      <>
        <Surface level="e2" data-testid="taskbar" />
        <Surface level="e1" data-testid="item" />
      </>,
    );
    expect(screen.getByTestId('item').getAttribute('data-blur')).toBe('live');

    // The engine changes the mode from outside React, so the re-render it causes has to be
    // flushed here the same way the browser would flush it.
    act(() => setMode('no-e1'));
    expect(screen.getByTestId('item').getAttribute('data-blur')).toBe('off');
    expect(screen.getByTestId('taskbar').getAttribute('data-blur')).toBe('live');

    act(() => setMode('off'));
    expect(live()).toHaveLength(0);
    expect(screen.getByTestId('taskbar').getAttribute('data-blur')).toBe('off');
  });
});
