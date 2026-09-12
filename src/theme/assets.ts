/**
 * Turning a theme's own file references into URLs the webview can actually load.
 *
 * A theme's files live wherever its folder is - inside the install for a bundled theme, under
 * %APPDATA% for one the user added - so nothing in a theme can carry a URL the page could load
 * directly. Everything goes through `assetUrl` (Tauri's `convertFileSrc`, or the path unchanged
 * in the browser mock).
 */

import { assetUrl } from '@/lib/assetUrl';

/**
 * The theme folder itself.
 *
 * `ThemeBundle.assetsDir` is `<theme>/assets`, so the root is one level up - and `layout.json`
 * and `theme.css` both reference their files from the root, not from `assets/`.
 */
export function themeRoot(assetsDir: string | null | undefined): string | undefined {
  if (!assetsDir) return undefined;
  return assetsDir.replace(/[\\/]assets[\\/]?$/, '');
}

/**
 * URL forms a stylesheet may carry that are already loadable, or are not file references at all:
 * any scheme (`data:`, `asset:`, `https:`), a protocol-relative or absolute path, and the `#id`
 * form that points at an SVG filter in the same document.
 */
const ALREADY_RESOLVED = /^(?:[a-z][a-z0-9+.-]+:|\/\/|\/|#)/i;

/**
 * Rewrite relative `url(...)` in a theme's CSS so it points at the theme's own files.
 *
 * `theme.css` is injected as a `<style>` element, which means the browser resolves its relative
 * URLs against the *page* - so `url('assets/fonts/Manrope-latin.woff2')` would ask the dev server
 * or the app bundle for a file that only exists in the theme folder, and quietly fall back to the
 * next font in the stack. Rewriting here is what makes a relative path work, and a relative path
 * is the only form the validators allow: an absolute one could point anywhere on disk.
 */
export function rewriteCssUrls(
  css: string,
  root: string | null | undefined,
  toUrl: (path: string) => string | undefined = assetUrl,
): string {
  if (!root) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote: string, target: string) => {
    const path = target.trim();
    if (path === '' || ALREADY_RESOLVED.test(path)) return whole;
    const resolved = toUrl(`${root}/${path}`);
    return resolved ? `url("${resolved}")` : whole;
  });
}
