/**
 * Accent discipline, enforced.
 *
 * Cyan means "the system is telling you something". If it also decorates, it stops reporting - so
 * every rule in the shell's stylesheets that reaches for the accent has to be listed below with
 * the reason it is allowed. A new one fails this test until somebody writes down why it is state
 * rather than decoration, which is the only way an audit survives the week it was done in.
 *
 * The design's own list:
 *
 *   allowed - the focus bloom around a white ring (the ring is white, the light is cyan); the
 *             running / focused-window taskbar indicator; progress; the single active filter
 *             chip, filled, with dark ink; one-glyph state marks; a folder tint the user chose.
 *   never   - body copy, labels or metadata; window chrome, title bars, borders or separators;
 *             large filled surfaces or gradients on glass; section headers and titles; hover;
 *             two accents at once.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const STYLES = dirname(fileURLToPath(import.meta.url));

/** The component sheets. `base.css` is where the tokens themselves live and is checked apart. */
const SHEETS = [
  'shell.css',
  'desktop.css',
  'folder.css',
  'taskbar.css',
  'window.css',
  'editor.css',
] as const;

/**
 * Every selector allowed to reach for the accent, and why.
 *
 * Keyed by selector exactly as written in the stylesheet, because the point is to notice when a
 * rule is added or changed.
 */
const ALLOWED: Record<string, string> = {
  // ---- focus: a white ring, lit cyan ----------------------------------------------------------
  '.aura-tile-wrap[data-focused] .aura-tile-art': 'focus bloom around the white ring',
  '.aura-folder[data-focused] .aura-folder-body': 'focus bloom around the white ring',
  '.aura-taskbar-button[data-focused]': 'focus bloom around the white ring',
  '.aura-window-control[data-focused]': 'focus bloom around the white ring',
  '.aura-window-chip[data-focused]': 'focus bloom around the white ring',
  '.aura-panel-button[data-focused]': 'focus bloom around the white ring',

  // ---- state the system is reporting ----------------------------------------------------------
  '.aura-scan-dot': 'a library scan is running - a one-glyph state mark',
  '.aura-tile-badge': 'the favourite marker - a one-glyph state mark',
  '.aura-taskbar-battery[data-charging]': 'charging - a one-glyph state mark',
  '.aura-widget-status-dot': 'something is running - a one-glyph state mark',
  ".aura-taskbar-indicator[data-state='focused']": 'the focused-window indicator, by name in the design',
  '.aura-toggle[data-on]': 'on or off is the state itself, on a control 1.45em tall',
  '.aura-choice[data-active]': 'which choice is selected',
  '.aura-panel-button[data-selected]': 'which option will be saved',
  '.aura-setting-arrow': 'the mark that says a row is adjustable - the controller-hint class',
  '.aura-desktop-drop': 'where a dragged item will land',
  '.aura-window-snap-preview': 'where a dragged window will land',
  '.aura-desktop-snap': "the design's own cyan snap grid, behind a debug flag",

  // ---- the one filled accent surface in the app -----------------------------------------------
  '.aura-window-chip[data-active]': 'the single filled accent chip, in dark ink',

  // ---- colour is the subject ------------------------------------------------------------------
  '.aura-swatch[data-default]': 'the swatch *is* the theme accent - it is what you are picking',
  '.aura-swatch[data-custom]': 'a spectrum, in a control whose subject is colour',

  /*
   * The one the design asks for twice and forbids once.
   *
   * Prompt 7 specifies "folder icon in accent cyan" in the window title bar; the accent rules say
   * never in title bars. It is a single glyph saying *which* folder this window is - the same
   * class as a state mark - so it stays, and the tension is recorded here rather than resolved
   * silently in either direction.
   */
  '.aura-window-icon': 'identifies which folder the window is - one glyph, specified by the design',
};

/** `selector { ... accent ... }` pairs, found by walking lines rather than parsing CSS. */
function accentRules(css: string): Array<{ selector: string; line: number; text: string }> {
  const lines = css.split(/\r?\n/);
  const out: Array<{ selector: string; line: number; text: string }> = [];
  const selectors: string[] = [];
  let pending: string[] = [];
  let inComment = false;

  lines.forEach((raw, index) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    const start = line.indexOf('/*');
    if (start !== -1 && !line.includes('*/', start)) {
      line = line.slice(0, start);
      inComment = true;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    if (line.trim() === '') return;

    if (line.includes('{')) {
      // Everything before the brace, plus any selector lines collected above it.
      const head = [...pending, line.slice(0, line.indexOf('{'))].join(' ').replace(/\s+/g, ' ').trim();
      selectors.push(head);
      pending = [];
    } else if (line.includes('}')) {
      selectors.pop();
    } else if (/[,{]\s*$/.test(line) || (!line.includes(':') && !line.includes(';'))) {
      // A selector split over several lines.
      pending.push(line.trim());
    }

    if (/accent/.test(line)) {
      const selector = selectors[selectors.length - 1] ?? '(file scope)';
      out.push({ selector, line: index + 1, text: line.trim() });
    }
  });

  return out;
}

describe('accent discipline', () => {
  for (const sheet of SHEETS) {
    it(`justifies every accent use in ${sheet}`, () => {
      const rules = accentRules(readFileSync(join(STYLES, sheet), 'utf8'));
      const unjustified = rules
        .filter((rule) => !(rule.selector in ALLOWED))
        // A rule that only names `--color-accent-contrast` is ink on someone else's fill.
        .filter((rule) => !/^[^:]*:\s*var\(--color-accent-contrast\)/.test(rule.text))
        .map((rule) => `${sheet}:${rule.line} ${rule.selector} -> ${rule.text}`);

      expect(unjustified).toEqual([]);
    });
  }

  it('never lets hover introduce the accent', () => {
    // Hover raises alpha. Every sheet, every rule whose selector mentions :hover.
    for (const sheet of SHEETS) {
      const css = readFileSync(join(STYLES, sheet), 'utf8');
      for (const rule of accentRules(css)) {
        if (!rule.selector.includes(':hover')) continue;
        expect(`${sheet}: ${rule.selector}`).toBe('no accent on hover');
      }
    }
  });

  it('keeps body copy, headers and window chrome off the accent', () => {
    /*
     * The classes that carry prose or structure. A regression here is the one that matters most:
     * it is how an accent stops meaning anything.
     */
    const forbidden = [
      '.aura-launch-body',
      '.aura-window-name',
      '.aura-window-subtitle',
      '.aura-window-title',
      '.aura-type-section',
      '.aura-window-section',
      '.aura-folder-label',
      '.aura-folder-meta',
      '.aura-tile-label',
      '.aura-desktop-icon-art',
      '.aura-widget-art',
    ];
    for (const sheet of SHEETS) {
      for (const rule of accentRules(readFileSync(join(STYLES, sheet), 'utf8'))) {
        for (const selector of forbidden) {
          expect(`${sheet}:${rule.line} ${rule.selector}`).not.toContain(selector);
        }
      }
    }
  });

  it('defines the accent tokens in base.css and nowhere else', () => {
    const base = readFileSync(join(STYLES, 'base.css'), 'utf8');
    expect(base).toMatch(/--color-accent:\s*#/);
    expect(base).toMatch(/--color-accent-contrast:\s*#/);
    // No component sheet may define its own accent value.
    for (const sheet of SHEETS) {
      expect(readFileSync(join(STYLES, sheet), 'utf8')).not.toMatch(/--color-accent:\s*#/);
    }
  });
});
