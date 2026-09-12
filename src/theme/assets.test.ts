/**
 * A theme referencing its own files.
 *
 * The rewrite is what lets `theme.css` use a relative path - the only form the validators allow.
 * Injected CSS resolves relative URLs against the page, so without this a bundled font silently
 * falls back to the next family in the stack, which is the kind of bug nobody reports.
 */

import { describe, expect, it } from 'vitest';

import { rewriteCssUrls, themeRoot } from './assets';

/** Stand-in for `assetUrl`, so these tests do not depend on Tauri being present. */
const fakeAssetUrl = (path: string) => `asset://localhost/${path.replace(/\\/g, '/')}`;

describe('themeRoot', () => {
  it('steps up out of the assets directory', () => {
    expect(themeRoot('C:/app/themes/aura-default/assets')).toBe('C:/app/themes/aura-default');
    expect(themeRoot('C:\\app\\themes\\aura-default\\assets')).toBe('C:\\app\\themes\\aura-default');
    expect(themeRoot('/themes/aura-default/assets/')).toBe('/themes/aura-default');
  });

  it('is undefined when there is no theme yet', () => {
    expect(themeRoot(undefined)).toBeUndefined();
    expect(themeRoot(null)).toBeUndefined();
  });
});

describe('rewriteCssUrls', () => {
  const root = 'C:/app/themes/aura-default';

  it('points a relative url at the theme folder', () => {
    const css = "@font-face { src: url('assets/fonts/Manrope-latin.woff2') format('woff2'); }";
    expect(rewriteCssUrls(css, root, fakeAssetUrl)).toContain(
      'url("asset://localhost/C:/app/themes/aura-default/assets/fonts/Manrope-latin.woff2")',
    );
  });

  it('handles every quoting style and stray whitespace', () => {
    const css = `a{background:url(a.png)} b{background:url( "b.png" )} c{background:url('c.png')}`;
    const out = rewriteCssUrls(css, root, fakeAssetUrl);
    for (const file of ['a.png', 'b.png', 'c.png']) {
      expect(out).toContain(`url("asset://localhost/${root}/${file}")`);
    }
  });

  it('leaves alone what is already loadable', () => {
    // A scheme, a protocol-relative URL, an absolute path, and an in-document SVG filter.
    const css = [
      'a{background:url(data:image/png;base64,AAA)}',
      'b{background:url(https://example.com/x.png)}',
      'c{background:url(asset://localhost/x.png)}',
      'd{background:url(//cdn/x.png)}',
      'e{background:url(/x.png)}',
      'f{filter:url(#grain)}',
    ].join('');
    expect(rewriteCssUrls(css, root, fakeAssetUrl)).toBe(css);
  });

  it('does not mistake a Windows drive letter for a URL scheme', () => {
    // One character before the colon is a drive, not a scheme. The validators refuse a theme
    // that writes one, so the only job here is not to wave it through as already-loadable.
    const out = rewriteCssUrls("a{background:url('C:/games/x.png')}", root, fakeAssetUrl);
    expect(out).not.toContain("url('C:/games/x.png')");
  });

  it('changes nothing when the theme has no folder yet', () => {
    const css = "a{background:url('x.png')}";
    expect(rewriteCssUrls(css, undefined, fakeAssetUrl)).toBe(css);
  });

  it('keeps the original url when the asset URL cannot be built', () => {
    const css = "a{background:url('x.png')}";
    expect(rewriteCssUrls(css, root, () => undefined)).toBe(css);
  });
});
