/**
 * Turning a theme's declared folder shape into geometry the desktop can draw.
 *
 * The shape of a folder is theme data, not component code: `layout.json` says how tall the
 * artwork is, what its corners do, and whether it has a tab, and this file is the only place
 * that reads it. Adding a fourth shape is an entry in a theme, not a branch in a component.
 *
 * Everything is re-checked here even though the core already sanitised it. The core is the
 * boundary that matters, but these values go into a `style` attribute and the cost of checking
 * twice is a few comparisons - so a theme loaded by an older host, or a bug in the sanitiser,
 * still cannot put arbitrary text into the DOM (docs/RISKS.md R5).
 */

import type { ThemeFolderShape } from '@/bridge';

/** Mirrors `MAX_SHAPE_PX` in `crates/aura-core/src/theme/validate.rs`. */
export const MAX_SHAPE_PX = 1024;

/** What the component needs, with every field resolved. */
export interface FolderGeometry {
  /** The shape id actually used, which may not be the one asked for. */
  id: string;
  height: number;
  radius: string;
  offsetTop: number;
  tab: { width: number; height: number; radius: string } | null;
}

/**
 * The geometry used when a theme declares a shape but no geometry for it.
 *
 * A theme that ships only ids and SVGs still gets usable folders rather than zero-height ones.
 */
export const DEFAULT_GEOMETRY: Omit<FolderGeometry, 'id'> = {
  height: 152,
  radius: '28px',
  offsetTop: 0,
  tab: null,
};

/**
 * Lengths, percentages and the `/` that separates horizontal from vertical radii - nothing else.
 *
 * No parentheses, so no `url()`, `var()` or `calc()`; no `;`, `:` or `}`, so a value cannot close
 * this declaration and open another. Mirrors `is_safe_css_length_list` in the core.
 */
const SAFE_LENGTHS = /^[0-9a-z.%/ ]+$/;

export function isSafeLengthList(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= 64 &&
    SAFE_LENGTHS.test(value) &&
    /[0-9]/.test(value)
  );
}

function px(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SHAPE_PX
    ? value
    : fallback;
}

function radius(value: unknown, fallback: string): string {
  return isSafeLengthList(value) ? value : fallback;
}

/**
 * Resolve one shape's geometry.
 *
 * `shape` being undefined is normal, not an error: shape ids are per theme - `rounded` means
 * something in one theme and nothing in the next - so a folder whose shape the active theme does
 * not offer is drawn with that theme's first shape. Without that, switching theme would leave
 * every existing folder on a generic fallback and a retheme would stop at the wallpaper.
 */
export function resolveGeometry(shape: ThemeFolderShape | undefined): FolderGeometry {
  if (!shape) return { id: 'default', ...DEFAULT_GEOMETRY };

  const tab = shape.tab;
  return {
    id: shape.id,
    height: px(shape.height, DEFAULT_GEOMETRY.height),
    radius: radius(shape.radius, DEFAULT_GEOMETRY.radius),
    offsetTop: px(shape.offsetTop, DEFAULT_GEOMETRY.offsetTop),
    tab:
      tab && typeof tab === 'object'
        ? {
            width: px(tab.width, 84),
            height: px(tab.height, 16),
            radius: radius(tab.radius, '10px 10px 0 0'),
          }
        : null,
  };
}

/**
 * Pick the shape a folder should use out of what the theme offers.
 *
 * Falls back to the theme's first shape, then to no shape at all - which `resolveGeometry` turns
 * into the plain rounded default.
 */
export function pickShape(
  shapes: ThemeFolderShape[],
  shapeId: string | null | undefined,
): ThemeFolderShape | undefined {
  return (shapeId ? shapes.find((s) => s.id === shapeId) : undefined) ?? shapes[0];
}
