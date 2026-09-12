/**
 * The aurora field's two structural promises.
 *
 * The look is a matter of taste and is checked by eye. What is not a matter of taste: the grain
 * covers the entire screen, so if it ever intercepts a pointer the whole desktop goes dead; and
 * the field has to be the *fallback*, drawn even when a shader or an image is what was asked
 * for, or a failed wallpaper leaves a hole.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuroraField } from './AuroraField';
import { resolveWallpaper } from './Background';

describe('AuroraField', () => {
  it('stacks the four layers the design calls for', () => {
    const { container } = render(<AuroraField />);
    for (const layer of ['primary', 'secondary', 'vignette', 'grain']) {
      expect(container.querySelector(`.aura-field-${layer}`)).not.toBeNull();
    }
  });

  it('generates its grain rather than shipping a texture', () => {
    const { container } = render(<AuroraField />);
    const turbulence = container.querySelector('feTurbulence');
    expect(turbulence?.getAttribute('type')).toBe('fractalNoise');
    // Desaturated: turbulence is coloured, and the field wants luminance noise, not confetti.
    expect(container.querySelector('feColorMatrix')?.getAttribute('values')).toBe('0');
  });

  it('hides the whole field from assistive technology', () => {
    // It is decoration covering the screen; a screen reader announcing it would be noise.
    render(<AuroraField />);
    expect(screen.getByTestId('aurora-field').querySelector('svg')).toHaveProperty(
      'ariaHidden',
      'true',
    );
  });
});

describe('resolveWallpaper', () => {
  it('falls back to the field when nothing asks for anything', () => {
    expect(resolveWallpaper(undefined, undefined)).toEqual({ kind: 'field' });
    expect(resolveWallpaper({ kind: 'theme' }, {})).toEqual({ kind: 'field' });
  });

  it('lets the theme choose a shader or an image', () => {
    expect(resolveWallpaper({ kind: 'theme' }, { background: { kind: 'shader', id: 'aurora' } })).toEqual({
      kind: 'shader',
      id: 'aurora',
    });
    expect(
      resolveWallpaper({ kind: 'theme' }, { fallbackBackground: { kind: 'image', path: 'a.png' } }),
    ).toEqual({ kind: 'image', path: 'a.png' });
  });

  it('lets the user override the theme', () => {
    expect(resolveWallpaper({ kind: 'color', hex: '#123456' }, { background: { kind: 'shader', id: 'x' } })).toEqual(
      { kind: 'color', hex: '#123456' },
    );
  });
});
