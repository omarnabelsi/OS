/**
 * The type roles exist, and components actually use them.
 *
 * A design system that is only a stylesheet drifts inside a single release: someone writes
 * `font-size: 18px` on the element instead, and the role quietly becomes decoration. This holds
 * `type.css` and the components together.
 *
 * `.node.test.ts` because it reads files: `src/` is browser code and its tsconfig has no node
 * types, so these are typechecked under `tsconfig.node.json` instead. Vitest stubs CSS imports to
 * an empty module - `?raw` included - so reading the stylesheet is the only way to assert on it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const STYLES = dirname(fileURLToPath(import.meta.url));
const SRC = dirname(STYLES);
const TYPE_CSS = readFileSync(join(STYLES, 'type.css'), 'utf8');

/** Every role the design defines, and where it belongs. */
const ROLES: Record<string, string> = {
  'aura-type-clock-hero': 'the desktop clock widget',
  'aura-type-clock': 'the taskbar clock',
  'aura-type-clock-date': 'the short date under the taskbar clock',
  'aura-type-widget-date': 'the long date under the desktop clock widget',
  'aura-type-folder-label': "a folder's name",
  'aura-type-folder-meta': "a folder's item count",
  'aura-type-tile-label': "a tile's title",
  'aura-type-tile-meta': "a tile's secondary line",
  'aura-type-window-title': "a window's title",
  'aura-type-window-subtitle': 'the line beside a window title',
  'aura-type-section': 'a section header',
};

/**
 * Roles with no component yet, and why.
 *
 * Empty, and worth keeping that way. It held `clock-hero` and `folder-meta` while the desktop
 * surface was still tile rows; the clock widget and the folder's meta line now use both. The
 * third test below fails if a role is added here without being used, or used without being
 * removed from this list.
 */
const NOT_YET_USED: string[] = [];

/** Component source only: a role named in a test (this one included) is not a usage. */
function componentSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) componentSources(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const FILES = componentSources(SRC);
const COMPONENTS = FILES.map((path) => readFileSync(path, 'utf8')).join('\n');

describe('type roles', () => {
  it('reads the component sources', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(ROLES))('defines .%s for %s', (role) => {
    expect(TYPE_CSS).toContain(`.${role} {`);
  });

  it.each(Object.entries(ROLES).filter(([role]) => !NOT_YET_USED.includes(role)))(
    '.%s is used by a component (%s)',
    (role) => {
      expect(COMPONENTS).toContain(role);
    },
  );

  it('has no unused role without a reason recorded here', () => {
    const unused = Object.keys(ROLES).filter((role) => !COMPONENTS.includes(role));
    expect(unused.sort()).toEqual([...NOT_YET_USED].sort());
  });

  it('defines no role that is not listed here', () => {
    const declared = [...TYPE_CSS.matchAll(/^\.(aura-type-[a-z-]+)\s*\{/gm)].map((m) => m[1] ?? '');
    expect(declared.length).toBe(Object.keys(ROLES).length);
    expect(declared.filter((role) => !(role in ROLES))).toEqual([]);
  });

  it('drives every role from tokens rather than hard-coded values', () => {
    // Sizes in rem so the UI Scale setting moves them; weight, family and ink from tokens.
    expect(TYPE_CSS).not.toMatch(/font-weight:\s*\d/);
    expect(TYPE_CSS).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});
