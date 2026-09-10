/**
 * The folder editor (brief section 7): label, shape, colour, icon, cover and layout.
 *
 * A window rather than a modal, and deliberately so - the whole point of it is the live
 * preview, and the folder it is editing should stay visible beside it. Every change is written
 * straight through `patchFolder`, which is optimistic, so the desktop icon and any open window
 * of that folder restyle on the keystroke.
 *
 * The shape list comes from the active theme, never from a set hard-coded here: a theme ships
 * its own silhouettes in `layout.json` `folderShapes` and this enumerates whatever it offers.
 * That is what makes "customisable" a property of the data rather than of this file.
 */

import { useEffect, useRef, useState } from 'react';

import { api, type FolderLayout } from '@/bridge';
import { useFocusable } from '@/focus';
import { useDesktopStore } from '@/store';
import type { WindowInstance } from '@/wm';
import { useWmStore } from '@/wm';

import { Icon, type IconName } from '../Icon';
import { FolderGlyph, useFolderShapes } from './FolderGlyph';

/** Icons a folder may wear. The built-in set, which is what `FolderGlyph` can draw. */
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
 * Swatches, not a colour wheel.
 *
 * A folder's tint is applied to a themed silhouette, and an arbitrary colour can fight the
 * theme badly. A short palette keeps every choice looking deliberate; the theme's own accent is
 * the first of them, so a retheme moves the default with it.
 */
const SWATCHES: readonly string[] = [
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

export function FolderEditor({ window: win }: { window: WindowInstance }): React.JSX.Element {
  const folder = useDesktopStore((s) => s.folderById(win.targetId));
  const patchFolder = useDesktopStore((s) => s.patchFolder);
  const deleteFolder = useDesktopStore((s) => s.deleteFolder);
  const shapes = useFolderShapes();
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

  return (
    <div className="aura-editor">
      {/* The preview is the reason this is a window. It is the real glyph, not a mock-up. */}
      <div className="aura-editor-preview">
        <FolderGlyph folder={folder} />
        <span className="aura-editor-preview-label">{folder.label ?? 'Untitled folder'}</span>
      </div>

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

      <Field label="Shape" hint={shapes.length === 0 ? 'This theme ships no folder shapes.' : undefined}>
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
              <FolderGlyph folder={{ ...folder, shape: shape.id, cover: null }} />
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="Colour">
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
          {SWATCHES.map((hex) => (
            <Choice
              key={hex}
              group={group}
              id={`colour-${hex}`}
              active={folder.color?.toLowerCase() === hex}
              label={hex}
              onPick={() => void patchFolder(folder.id, { color: hex })}
            >
              <span className="aura-swatch" style={{ background: hex }} />
            </Choice>
          ))}
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
        </div>
      </Field>

      <Field label="Cover" hint="An image replaces the icon on the folder.">
        <div className="aura-editor-row">
          <TextButton
            group={group}
            id="cover-pick"
            label={folder.cover ? 'Change image…' : 'Choose image…'}
            onPick={() => {
              void (async () => {
                const path = await api.pickFile('image');
                if (path) void patchFolder(folder.id, { cover: path });
              })();
            }}
          />
          {folder.cover ? (
            <TextButton
              group={group}
              id="cover-clear"
              label="Remove"
              onPick={() => void patchFolder(folder.id, { cover: null })}
            />
          ) : null}
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
            // The folder goes; the entries in it do not. A smart folder is a saved filter and a
            // collection is a grouping - neither owns the games it shows.
            void deleteFolder(folder.id);
            closeWindow(win.id);
          }}
        />
      </div>
    </div>
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
      <h3>{label}</h3>
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
  onPick,
}: {
  group: string;
  id: string;
  label: string;
  danger?: boolean;
  onPick(): void;
}): React.JSX.Element {
  const { ref, props } = useFocusable({ id: `${group}:${id}`, group, onActivate: onPick });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-text-button"
      data-danger={danger || undefined}
      {...props}
    >
      {label}
    </button>
  );
}
