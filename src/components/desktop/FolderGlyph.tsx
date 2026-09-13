/**
 * How a folder looks on the desktop: a theme-supplied shape, tinted, with an icon or a cover.
 *
 * The shape list comes from the active theme's `layout.json` `folderShapes`, never from a
 * hard-coded set here - a theme ships its own SVGs and the folder editor enumerates whatever it
 * offers. The loader has already dropped any entry whose asset escaped the theme folder.
 */

import type { Folder, ThemeFolderShape } from '@/bridge';
import { assetUrl } from '@/lib/assetUrl';
import { useTheme } from '@/theme';

import { Icon, isIconName, type IconName } from '../Icon';

/** The shapes the active theme declares, in the order it declares them. */
export function useFolderShapes(): ThemeFolderShape[] {
  const { bundle } = useTheme();
  const declared = bundle?.layout?.folderShapes;
  return Array.isArray(declared) ? declared : [];
}

/**
 * Resolve a shape id to a loadable URL.
 *
 * `layout.json` asset paths are relative to the theme folder, and `assetsDir` is the absolute
 * path of `<theme>/assets`, so the theme root is one level up from it.
 *
 * A folder whose shape the active theme does not offer takes the theme's *first* shape rather
 * than none. Shape ids are per theme - `rounded` means something in one and nothing in the
 * next - so without this, switching theme would leave every existing folder on the generic
 * fallback instead of restyling it, and a retheme would stop at the wallpaper.
 */
export function useShapeUrl(shapeId: string | null | undefined): string | undefined {
  const { bundle } = useTheme();
  const shapes = useFolderShapes();
  if (!bundle) return undefined;

  const shape = (shapeId ? shapes.find((s) => s.id === shapeId) : undefined) ?? shapes[0];
  if (!shape) return undefined;

  const root = bundle.assetsDir.replace(/[\\/]assets[\\/]?$/, '');
  return assetUrl(`${root}/${shape.asset}`);
}

export interface FolderGlyphProps {
  folder: Folder | undefined;
  /** Falls back to the theme icon when the folder names one we know. */
  fallbackIcon?: IconName;
}

/**
 * A folder's visual. Layered so a theme can restyle any part:
 *   shape (mask + tint) -> cover image, or icon, or nothing.
 */
export function FolderGlyph({ folder, fallbackIcon = 'files' }: FolderGlyphProps): React.JSX.Element {
  const shapeUrl = useShapeUrl(folder?.shape);
  const cover = folder?.cover ? assetUrl(folder.cover) : undefined;
  const tint = folder?.color ?? undefined;

  // `folder.icon` is either a theme icon key or a user-picked image path (11d) - the two share a
  // column, so a value that is not one of the active theme's known names is resolved as a path
  // instead, through the same `assetUrl` a cover already goes through.
  const iconValue = folder?.icon ?? undefined;
  const knownIcon = iconValue && isIconName(iconValue) ? iconValue : undefined;
  const customIcon = iconValue && !knownIcon ? assetUrl(iconValue) : undefined;

  return (
    <span className="aura-glyph" style={tint ? { '--folder-tint': tint } as React.CSSProperties : undefined}>
      {/*
        The shape is a mask rather than an <img>, so the tint colours it and a theme can ship a
        flat silhouette instead of having to bake every colour into the SVG.
      */}
      <span
        className="aura-glyph-shape"
        data-fallback={shapeUrl ? undefined : true}
        style={
          shapeUrl
            ? ({
                maskImage: `url("${shapeUrl}")`,
                WebkitMaskImage: `url("${shapeUrl}")`,
              } as React.CSSProperties)
            : undefined
        }
      />

      {cover ? (
        <img className="aura-glyph-cover" src={cover} alt="" draggable={false} />
      ) : customIcon ? (
        <img className="aura-glyph-cover aura-glyph-icon-image" src={customIcon} alt="" draggable={false} />
      ) : (
        <span className="aura-glyph-icon">
          <Icon name={knownIcon ?? fallbackIcon} size="1em" />
        </span>
      )}
    </span>
  );
}
