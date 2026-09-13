/**
 * The folder editor: label, shape, tint, icon, cover and layout, beside a live preview.
 *
 * A window rather than a modal, and deliberately so - the whole point of it is the preview, and
 * the folder it is editing should stay visible beside it. Every change is written straight
 * through `patchFolder`, which is optimistic, so the desktop icon, any open window of that folder
 * and the preview all restyle on the keystroke.
 *
 * **The preview is the real `<Folder>` component**, at the size it has on the desktop, and not a
 * second renderer that would drift from it. It is handed `interactive={false}`, so it does not
 * take focus, drag, or answer the pointer - it is a picture of the folder, drawn by the thing that
 * draws folders.
 *
 * The shape list and the tint palette both come from the active theme, never from a set
 * hard-coded here: a theme ships its silhouettes in `layout.json` and its palette in
 * `tokens.json`, and this enumerates whatever it offers. That is what makes "customisable" a
 * property of the data rather than of this file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { api, type DesktopItem, type Folder as FolderRecord, type FolderLayout } from '@/bridge';
import { useFocusable } from '@/focus';
import { assetUrl } from '@/lib/assetUrl';
import { useDesktopStore } from '@/store';
import { useTheme } from '@/theme';
import type { WindowInstance } from '@/wm';
import { useWmStore } from '@/wm';

import { Icon, isIconName, type IconName } from '../Icon';
import { Folder } from './Folder';
import { pickShape, resolveGeometry } from './folderShape';
import { useFolderShapes } from './FolderGlyph';

/** Icons a folder may wear. The built-in set, which is what the folder can draw. */
const FOLDER_ICONS: readonly IconName[] = [
  'folder',
  'files',
  'games',
  'apps',
  'media',
  'star',
  'play',
  'image',
  'home',
  'settings',
  'desktop',
  'clock',
];

/**
 * Swatches for a theme that ships no palette of its own.
 *
 * A folder's tint is applied to a themed silhouette, and an arbitrary colour can fight the theme
 * badly. A short palette keeps every choice looking deliberate.
 */
const FALLBACK_SWATCHES: readonly string[] = [
  '#6ee7ff',
  '#7c9cff',
  '#b48cff',
  '#ff8ccf',
  '#ff8d6b',
  '#ffc861',
  '#8fe38f',
  '#9aa6b8',
];

const LAYOUTS: ReadonlyArray<{ id: FolderLayout; label: string; hint: string }> = [
  { id: 'grid', label: 'Grid', hint: 'Artwork tiles with names' },
  { id: 'list', label: 'List', hint: 'A dense row each — best for big folders' },
  { id: 'covers', label: 'Covers', hint: 'Large artwork, no captions' },
];

/** The theme's tint palette, or the fallback above when it ships none. */
function usePalette(): readonly string[] {
  const { bundle } = useTheme();
  return useMemo(() => {
    const palette = bundle?.tokens?.palette;
    const values = palette
      ? Object.values(palette).filter((v): v is string => typeof v === 'string')
      : [];
    return values.length > 0 ? values : FALLBACK_SWATCHES;
  }, [bundle?.tokens?.palette]);
}

export function FolderEditor({ window: win }: { window: WindowInstance }): React.JSX.Element {
  const folder = useDesktopStore((s) => s.folderById(win.targetId));
  const patchFolder = useDesktopStore((s) => s.patchFolder);
  const deleteFolder = useDesktopStore((s) => s.deleteFolder);
  const folderContents = useDesktopStore((s) => s.folderContents);
  const shapes = useFolderShapes();
  const palette = usePalette();
  const closeWindow = useWmStore((s) => s.close);

  const group = `window:${win.id}`;

  /*
   * The label is the one field held locally.
   *
   * Everything else is a discrete choice - one click, one write - but a name is typed, and
   * writing per keystroke would put a row of half-finished names through the database and make
   * every character a round trip. It commits on blur and on Enter.
   */
  const [label, setLabel] = useState(folder?.label ?? '');
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setLabel(folder?.label ?? '');
  }, [folder?.label]);

  /*
   * The folder as it was when the editor opened, for Cancel.
   *
   * Changes apply live, which is the point - so "cancel" cannot mean "do not save", it means put
   * back what was there. Captured once, on the first render that has a folder.
   */
  const original = useRef<FolderRecord | null>(null);
  useEffect(() => {
    if (folder && !original.current) original.current = { ...folder };
  }, [folder]);

  // The count under the preview's label, so the preview is the folder as the desktop draws it.
  const [count, setCount] = useState<number | null>(null);
  const targetId = folder?.id;
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void folderContents(targetId)
      .then((items) => {
        if (!cancelled) setCount(items.length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, folderContents]);

  const customColour = useRef<HTMLInputElement | null>(null);

  /** A stand-in desktop item, so the preview can be the real component. */
  const previewItem = useMemo<DesktopItem>(
    () => ({
      id: `preview:${targetId ?? 'none'}`,
      desktopId: '',
      kind: 'folder',
      targetId: targetId ?? null,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      labelOverride: null,
      iconOverride: null,
      sortOrder: 0,
    }),
    [targetId],
  );

  if (!folder) {
    return (
      <div className="aura-empty">
        <h2>That folder is gone</h2>
        <p>It was deleted while this editor was open.</p>
      </div>
    );
  }

  const commitLabel = () => {
    editing.current = false;
    const next = label.trim();
    if (next === (folder.label ?? '')) return;
    void patchFolder(folder.id, { label: next === '' ? null : next });
  };

  /** Put back every field this editor can change, then close. */
  const cancel = () => {
    const before = original.current;
    if (before) {
      void patchFolder(folder.id, {
        label: before.label,
        color: before.color,
        icon: before.icon,
        cover: before.cover,
        shape: before.shape,
        layout: before.layout,
      });
    }
    closeWindow(win.id);
  };

  /*
   * Save closes, and that is all it needs to do.
   *
   * Every control already wrote through - that is what makes the preview and the desktop behind
   * it live. Pretending to save here would be theatre; what the button really promises is "keep
   * what I did", and the honest implementation of that is to stop reverting it.
   */
  const save = () => {
    if (editing.current) commitLabel();
    closeWindow(win.id);
  };

  const tint = folder.color?.toLowerCase() ?? null;
  const isCustomTint = tint !== null && !palette.some((hex) => hex.toLowerCase() === tint);

  // `folder.icon` is either a theme icon key or a user-picked image (11d) - the two share a
  // column, so a value that is not one of `FOLDER_ICONS` is a custom icon, not an unset field.
  const isCustomIcon = Boolean(folder.icon) && !isIconName(folder.icon);
  const customIconUrl = isCustomIcon ? assetUrl(folder.icon) : undefined;

  return (
    <div className="aura-editor">
      <aside className="aura-editor-preview">
        <h3 className="aura-type-section">Live preview</h3>

        <div className="aura-editor-preview-stage">
          {/* The real component, at real size. Never a preview renderer of its own. */}
          <Folder
            item={previewItem}
            folder={folder}
            count={count}
            dragOffset={null}
            group={group}
            interactive={false}
          />
        </div>

        <p className="aura-editor-preview-note">Changes apply live on the desktop.</p>
      </aside>

      <div className="aura-editor-controls">
        <div className="aura-editor-fields">
          <Field label="Name">
            <input
              className="aura-input"
              value={label}
              placeholder="Untitled folder"
              onChange={(e) => {
                editing.current = true;
                setLabel(e.target.value);
              }}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  editing.current = false;
                  setLabel(folder.label ?? '');
                  e.currentTarget.blur();
                }
              }}
            />
          </Field>

          <Field
            label="Shape"
            hint={shapes.length === 0 ? 'This theme ships no folder shapes.' : undefined}
          >
            <div className="aura-editor-row">
              {shapes.map((shape) => (
                <Choice
                  key={shape.id}
                  group={group}
                  id={`shape-${shape.id}`}
                  active={folder.shape === shape.id}
                  label={shape.id}
                  onPick={() => void patchFolder(folder.id, { shape: shape.id })}
                >
                  {/*
                    A miniature of the actual shape, not the word for it - the theme's own
                    geometry at a fraction of the size, so a shape that is 104px tall with a 56px
                    radius looks like exactly that here. Scaled rather than re-measured, because a
                    `border-radius` of "6px 28px 28px 28px" cannot be scaled by arithmetic.
                  */}
                  <ShapeMiniature shapeId={shape.id} />
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="Tint">
            <div className="aura-editor-row">
              <Choice
                group={group}
                id="colour-none"
                active={folder.color === null}
                label="Theme colour"
                onPick={() => void patchFolder(folder.id, { color: null })}
              >
                <span className="aura-swatch" data-default />
              </Choice>
              {palette.map((hex) => (
                <Choice
                  key={hex}
                  group={group}
                  id={`colour-${hex}`}
                  active={tint === hex.toLowerCase()}
                  label={hex}
                  onPick={() => void patchFolder(folder.id, { color: hex })}
                >
                  <span className="aura-swatch" style={{ background: hex }} />
                </Choice>
              ))}

              <Choice
                group={group}
                id="colour-custom"
                active={isCustomTint}
                label="Custom colour"
                onPick={() => customColour.current?.click()}
              >
                <span
                  className="aura-swatch"
                  data-custom
                  style={isCustomTint && folder.color ? { background: folder.color } : undefined}
                />
              </Choice>
              <input
                ref={customColour}
                type="color"
                className="aura-editor-colour-input"
                value={folder.color ?? '#6ee7ff'}
                onChange={(e) => void patchFolder(folder.id, { color: e.target.value })}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </Field>

          <Field label="Icon" hint={folder.cover ? 'Hidden while a cover image is set.' : undefined}>
            <div className="aura-editor-row">
              {FOLDER_ICONS.map((name) => (
                <Choice
                  key={name}
                  group={group}
                  id={`icon-${name}`}
                  active={folder.icon === name}
                  label={name}
                  onPick={() => void patchFolder(folder.id, { icon: name })}
                >
                  <Icon name={name} size="1.1em" />
                </Choice>
              ))}

              <Choice
                group={group}
                id="icon-custom"
                active={isCustomIcon}
                label="Custom image"
                onPick={() => {
                  void (async () => {
                    const path = await api.pickFile('image');
                    // `setFolderIcon`, not an `icon` patch straight from the picker: the host
                    // copies the image into the artwork cache, the same way a cover does, so it
                    // survives the original file being moved.
                    if (path) await api.setFolderIcon(folder.id, path);
                  })();
                }}
              >
                {customIconUrl ? (
                  <img
                    className="aura-choice-icon-image"
                    src={customIconUrl}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span aria-hidden="true">···</span>
                )}
              </Choice>
            </div>
          </Field>

          <Field label="Cover" hint="An image replaces the icon on the folder.">
            <div className="aura-editor-row">
              <TextButton
                group={group}
                id="cover-pick"
                label={folder.cover ? 'Change file…' : 'Choose file…'}
                onPick={() => {
                  void (async () => {
                    const path = await api.pickFile('image');
                    // `setFolderCover`, not a `cover` patch: the host copies the image into the
                    // artwork cache, so it survives the original being moved.
                    if (path) await api.setFolderCover(folder.id, path);
                  })();
                }}
              />
              <TextButton
                group={group}
                id="cover-clear"
                label="None"
                disabled={!folder.cover}
                onPick={() => void patchFolder(folder.id, { cover: null })}
              />
            </div>
          </Field>

          <Field label="Layout">
            <div className="aura-editor-stack">
              {LAYOUTS.map((option) => (
                <Choice
                  key={option.id}
                  group={group}
                  id={`layout-${option.id}`}
                  active={folder.layout === option.id}
                  label={option.label}
                  wide
                  onPick={() => void patchFolder(folder.id, { layout: option.id })}
                >
                  <span className="aura-editor-option">
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </Choice>
              ))}
            </div>
          </Field>

          <div className="aura-editor-danger">
            <TextButton
              group={group}
              id="delete"
              label="Delete this folder"
              danger
              onPick={() => {
                // The folder goes; the entries in it do not. A smart folder is a saved filter and
                // a collection is a grouping - neither owns the games it shows.
                void deleteFolder(folder.id);
                closeWindow(win.id);
              }}
            />
          </div>
        </div>

        <footer className="aura-editor-footer">
          <TextButton group={group} id="cancel" label="Cancel" onPick={cancel} />
          <TextButton group={group} id="save" label="Save folder" primary onPick={save} />
        </footer>
      </div>
    </div>
  );
}

/**
 * One shape, drawn small.
 *
 * The real geometry - height, radius and tab - scaled down by a transform. Nothing here knows
 * what "capsule" means; it asks `folderShape.ts` for whatever the theme declared.
 */
function ShapeMiniature({ shapeId }: { shapeId: string }): React.JSX.Element {
  const shapes = useFolderShapes();
  const geometry = useMemo(() => resolveGeometry(pickShape(shapes, shapeId)), [shapes, shapeId]);

  return (
    <span className="aura-editor-shape" aria-hidden="true">
      <span className="aura-editor-shape-scale">
        {geometry.tab ? (
          <span
            className="aura-editor-shape-tab"
            style={{
              width: geometry.tab.width,
              height: geometry.tab.height,
              borderRadius: geometry.tab.radius,
            }}
          />
        ) : null}
        <span
          className="aura-editor-shape-body"
          style={{ height: geometry.height, borderRadius: geometry.radius }}
        />
      </span>
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="aura-editor-field">
      <h3 className="aura-type-section">{label}</h3>
      {children}
      {hint ? <p className="aura-editor-hint">{hint}</p> : null}
    </section>
  );
}

function Choice({
  group,
  id,
  active,
  label,
  wide,
  onPick,
  children,
}: {
  group: string;
  id: string;
  active: boolean;
  label: string;
  wide?: boolean;
  onPick(): void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { ref, props } = useFocusable({ id: `${group}:${id}`, group, onActivate: onPick });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-choice"
      data-active={active || undefined}
      data-wide={wide || undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...props}
    >
      {children}
    </button>
  );
}

function TextButton({
  group,
  id,
  label,
  danger,
  primary,
  disabled,
  onPick,
}: {
  group: string;
  id: string;
  label: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onPick(): void;
}): React.JSX.Element {
  const { ref, props } = useFocusable({
    id: `${group}:${id}`,
    group,
    disabled,
    onActivate: onPick,
  });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-text-button"
      data-danger={danger || undefined}
      data-primary={primary || undefined}
      disabled={disabled || undefined}
      {...props}
    >
      {label}
    </button>
  );
}
