/**
 * Nested token groups.
 *
 * The flattener used to walk exactly two levels, so `font.weight.label` - which the type system
 * is built on - was dropped without a word: a theme could set it and watch nothing happen.
 */

import { describe, expect, it } from 'vitest';

import { flattenTokens } from './tokens';

describe('flattenTokens with nested groups', () => {
  it('joins a nested path into one custom property', () => {
    const vars = flattenTokens({
      font: { family: "'Manrope'", weight: { label: 600, meta: 500 } },
      elevation: { e1: { shadow: '0 22px 46px -22px rgba(0,0,0,.9)', blur: '18px' } },
    });

    expect(vars['--font-family']).toBe("'Manrope'");
    expect(vars['--font-weight-label']).toBe('600');
    expect(vars['--font-weight-meta']).toBe('500');
    expect(vars['--elevation-e1-shadow']).toBe('0 22px 46px -22px rgba(0,0,0,.9)');
    expect(vars['--elevation-e1-blur']).toBe('18px');
  });

  it('still flattens the two-level groups exactly as before', () => {
    const vars = flattenTokens({ color: { surfaceStrong: 'rgba(255,255,255,.12)' }, tile: { focusScale: 1.08 } });
    expect(vars['--color-surface-strong']).toBe('rgba(255,255,255,.12)');
    expect(vars['--tile-focus-scale']).toBe('1.08');
  });

  it('ignores a bare value at the top level - every token is group.key at least', () => {
    expect(flattenTokens({ accent: '#fff' } as never)).toEqual({});
  });

  it('ignores arrays and stops at a sane depth rather than walking forever', () => {
    const deep = { a: { b: { c: { d: { e: 'too far' } } } }, list: { items: ['x'] } };
    const vars = flattenTokens(deep as never);
    expect(vars['--list-items']).toBeUndefined();
    expect(Object.values(vars)).not.toContain('too far');
    // Three levels is the deepest the format defines, and it still works.
    expect(flattenTokens({ a: { b: { c: 'kept' } } } as never)['--a-b-c']).toBe('kept');
  });
});
