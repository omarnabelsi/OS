/**
 * Folder shape geometry, and the sanitising that makes it safe to use.
 *
 * The radius goes into a `style` attribute and `layout.json` comes from a shared theme, so the
 * rejection cases are the point of this file, not an afterthought (docs/RISKS.md R5). The core
 * sanitises first; this is the second line, and the one that runs against whatever a host handed
 * over - including an older host that did not sanitise at all.
 */

import { describe, expect, it } from 'vitest';

import type { ThemeFolderShape } from '@/bridge';

import { DEFAULT_GEOMETRY, isSafeLengthList, pickShape, resolveGeometry } from './folderShape';

describe('isSafeLengthList', () => {
  it('accepts the forms a border-radius actually takes', () => {
    for (const value of ['28px', '56px', '6px 28px 28px 28px', '10px 10px 0 0', '50%', '2px 4px / 3px 5px']) {
      expect(isSafeLengthList(value)).toBe(true);
    }
  });

  it('refuses anything that could escape the declaration', () => {
    for (const value of [
      'url(evil.png)',
      'var(--x)',
      'calc(100% - 2px)',
      '28px; background: red',
      '28px} .a {color:red',
      '/* */28px',
      'inherit',
      '',
      '   ',
      'a'.repeat(65),
    ]) {
      expect(isSafeLengthList(value), value).toBe(false);
    }
  });

  it('refuses a value with no number in it at all', () => {
    // `px` alone is not a length, and a bare keyword is not something a theme should be sending.
    expect(isSafeLengthList('px')).toBe(false);
  });
});

describe('resolveGeometry', () => {
  it('falls back to a plain rounded shape when the theme declares none', () => {
    expect(resolveGeometry(undefined)).toEqual({ id: 'default', ...DEFAULT_GEOMETRY });
  });

  it('reads the design geometry for the three bundled shapes', () => {
    expect(resolveGeometry({ id: 'rounded', asset: 'a.svg', height: 152, radius: '28px' })).toMatchObject({
      height: 152,
      radius: '28px',
      offsetTop: 0,
      tab: null,
    });

    // The capsule is pushed down so its optical centre lines up with its taller neighbours.
    expect(
      resolveGeometry({ id: 'capsule', asset: 'a.svg', height: 104, radius: '56px', offsetTop: 24 }),
    ).toMatchObject({ height: 104, radius: '56px', offsetTop: 24 });

    expect(
      resolveGeometry({
        id: 'tab',
        asset: 'a.svg',
        height: 152,
        radius: '6px 28px 28px 28px',
        tab: { width: 84, height: 16, radius: '10px 10px 0 0' },
      }),
    ).toMatchObject({
      radius: '6px 28px 28px 28px',
      tab: { width: 84, height: 16, radius: '10px 10px 0 0' },
    });
  });

  it('drops a dangerous radius and keeps the shape', () => {
    const shape = { id: 'evil', asset: 'a.svg', height: 150, radius: '28px; position: fixed' };
    const geometry = resolveGeometry(shape as ThemeFolderShape);
    // The shape still renders - it just renders with the default corners.
    expect(geometry.id).toBe('evil');
    expect(geometry.height).toBe(150);
    expect(geometry.radius).toBe(DEFAULT_GEOMETRY.radius);
  });

  it('refuses a size that would take over the screen', () => {
    const geometry = resolveGeometry({ id: 'huge', asset: 'a.svg', height: 40_000 });
    expect(geometry.height).toBe(DEFAULT_GEOMETRY.height);
  });

  it('refuses sizes that are not finite positive numbers', () => {
    for (const height of [Number.NaN, Number.POSITIVE_INFINITY, -10, '152' as unknown as number]) {
      expect(resolveGeometry({ id: 's', asset: 'a.svg', height }).height).toBe(DEFAULT_GEOMETRY.height);
    }
  });

  it('ignores a tab that is not an object', () => {
    const geometry = resolveGeometry({
      id: 's',
      asset: 'a.svg',
      tab: 'yes' as unknown as ThemeFolderShape['tab'],
    });
    expect(geometry.tab).toBeNull();
  });

  it('fills in a partial tab rather than rendering a zero-sized one', () => {
    expect(resolveGeometry({ id: 's', asset: 'a.svg', tab: {} }).tab).toEqual({
      width: 84,
      height: 16,
      radius: '10px 10px 0 0',
    });
  });
});

describe('pickShape', () => {
  const shapes: ThemeFolderShape[] = [
    { id: 'binder', asset: 'b.svg' },
    { id: 'envelope', asset: 'e.svg' },
  ];

  it('finds the shape a folder asked for', () => {
    expect(pickShape(shapes, 'envelope')?.id).toBe('envelope');
  });

  it("falls back to the theme's first shape, not to nothing", () => {
    // Shape ids are per theme: `rounded` means something in one and nothing in the next, so a
    // folder made under another theme must still be restyled rather than left generic.
    expect(pickShape(shapes, 'rounded')?.id).toBe('binder');
    expect(pickShape(shapes, null)?.id).toBe('binder');
  });

  it('has nothing to offer when the theme declares no shapes', () => {
    expect(pickShape([], 'rounded')).toBeUndefined();
  });
});
