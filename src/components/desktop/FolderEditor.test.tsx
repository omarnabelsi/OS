/**
 * The folder editor.
 *
 * The claim worth testing is the one the design makes: the preview is the *real* `<Folder>`
 * component, so nothing can drift between the pane and the desktop. Everything else here is the
 * write-through - every control changes the folder immediately - and what Cancel therefore has to
 * mean, which is "put back what was there", not "do not save".
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Folder } from '@/bridge';

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});

// The engine has its own tests; a focusable here only has to be clickable.
vi.mock('@/focus', () => ({
  useFocusable: (options: { onActivate?: () => void; disabled?: boolean }) => ({
    ref: () => {},
    focused: false,
    visible: false,
    props: {
      tabIndex: -1,
      onClick: () => {
        if (!options.disabled) options.onActivate?.();
      },
    },
  }),
}));

const SHAPES = [
  { id: 'rounded', asset: 'assets/folders/rounded.svg', height: 152, radius: '28px' },
  { id: 'capsule', asset: 'assets/folders/capsule.svg', height: 104, radius: '56px', offsetTop: 24 },
  {
    id: 'tab',
    asset: 'assets/folders/tab.svg',
    height: 152,
    radius: '6px 28px 28px 28px',
    tab: { width: 84, height: 16, radius: '10px 10px 0 0' },
  },
];

const PALETTE = { accent: '#6ee7ff', mint: '#8fe38f', amber: '#ffc861' };

vi.mock('@/theme', () => ({
  useTheme: () => ({
    bundle: {
      layout: { folderShapes: SHAPES },
      tokens: { palette: PALETTE },
      assetsDir: 'C:/themes/aura-default/assets',
    },
  }),
}));

const { baseSettings, fakeApi, resetFakeApi } = await import('@/store/test-helpers');
const { useDesktopStore, useSettingsStore } = await import('@/store');
const { resetWm, useWmStore } = await import('@/wm');
const { FolderEditor } = await import('./FolderEditor');
const { resetBudget } = await import('@/surface');

const folder: Folder = {
  id: 'f1',
  path: 'smart:games',
  label: 'Games',
  color: null,
  icon: 'games',
  cover: null,
  layout: 'grid',
  shape: 'rounded',
  kind: 'smart',
  collectionId: null,
  filter: null,
  windowState: null,
  sortOrder: 0,
};

function openEditor() {
  const id = useWmStore.getState().open({
    kind: 'folderEditor',
    targetId: folder.id,
    title: 'Edit Games',
    size: { width: 1260, height: 748 },
  });
  const win = useWmStore.getState().windows.find((w) => w.id === id)!;
  return { win, ...render(<FolderEditor window={win} />) };
}

const previewFolder = () => document.querySelector('.aura-editor-preview .aura-folder');

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeApi();
  resetWm();
  resetBudget();
  useSettingsStore.setState({ settings: { ...baseSettings } });
  useDesktopStore.setState({ folders: [{ ...folder }], error: null });
  fakeApi.folderContents.mockResolvedValue([]);
  fakeApi.updateFolder.mockImplementation(async (_id, patch) => ({ ...folder, ...patch }) as Folder);
});

describe('FolderEditor', () => {
  it('previews with the real <Folder> component, not a copy of it', () => {
    openEditor();
    const preview = previewFolder();
    expect(preview).not.toBeNull();
    // The component's own structure, which a bespoke preview renderer would not have.
    expect(preview?.querySelector('.aura-folder-art')).not.toBeNull();
    expect(preview?.querySelector('.aura-folder-body')).not.toBeNull();
    expect(preview?.querySelector('.aura-folder-label')?.textContent).toBe('Games');
    expect(preview?.getAttribute('data-shape')).toBe('rounded');
  });

  it('takes no focus and no click in the preview', () => {
    openEditor();
    // Disabled in the engine, so a D-pad cannot stop on a picture of a folder.
    fireEvent.click(previewFolder()!);
    expect(useWmStore.getState().windows).toHaveLength(1);
  });

  it('updates the preview when the shape changes', async () => {
    openEditor();
    fireEvent.click(screen.getByLabelText('capsule'));

    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { shape: 'capsule' });
    // Optimistic: the preview is the new shape before the core has answered.
    await waitFor(() => expect(previewFolder()?.getAttribute('data-shape')).toBe('capsule'));
  });

  it('offers the theme\u2019s palette, not a list of its own', () => {
    openEditor();
    for (const hex of Object.values(PALETTE)) {
      expect(screen.getByLabelText(hex)).toBeDefined();
    }
    // Colours from the old hard-coded set that this theme does not offer are absent.
    expect(screen.queryByLabelText('#b48cff')).toBeNull();
  });

  it('tints on a swatch and clears back to the theme colour', async () => {
    openEditor();
    fireEvent.click(screen.getByLabelText('#8fe38f'));
    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { color: '#8fe38f' });
    await waitFor(() => expect(previewFolder()?.getAttribute('data-tinted')).toBe('true'));

    fireEvent.click(screen.getByLabelText('Theme colour'));
    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { color: null });
  });

  it('draws each shape choice as a miniature of that shape', () => {
    openEditor();
    const capsule = screen.getByLabelText('capsule').querySelector('.aura-editor-shape-body') as HTMLElement;
    // The theme's own geometry, at full size, scaled by CSS - so it is the shape, not a glyph.
    expect(capsule.style.height).toBe('104px');
    expect(capsule.style.borderRadius).toBe('56px');
    expect(screen.getByLabelText('tab').querySelector('.aura-editor-shape-tab')).not.toBeNull();
    expect(screen.getByLabelText('rounded').querySelector('.aura-editor-shape-tab')).toBeNull();
  });

  it('sends a chosen cover through the artwork cache, never as a raw path', async () => {
    fakeApi.pickFile.mockResolvedValue('C:/pics/cover.png');
    fakeApi.setFolderCover.mockResolvedValue({ ...folder, cover: 'C:/cache/folder-f1/grid-user-ab.png' });
    openEditor();

    // A text button is named by its text; only the icon-sized choices carry an aria-label.
    fireEvent.click(screen.getByText('Choose file…'));
    await waitFor(() => expect(fakeApi.setFolderCover).toHaveBeenCalledWith('f1', 'C:/pics/cover.png'));
    expect(fakeApi.updateFolder).not.toHaveBeenCalledWith('f1', { cover: 'C:/pics/cover.png' });
  });

  it('puts everything back on Cancel, and closes', async () => {
    const { win } = openEditor();

    fireEvent.click(screen.getByLabelText('capsule'));
    fireEvent.click(screen.getByLabelText('#ffc861'));
    await waitFor(() => expect(previewFolder()?.getAttribute('data-shape')).toBe('capsule'));

    fireEvent.click(screen.getByText('Cancel'));

    // The last write restores every field this editor can change, to what it found them at.
    expect(fakeApi.updateFolder).toHaveBeenLastCalledWith('f1', {
      label: 'Games',
      color: null,
      icon: 'games',
      cover: null,
      shape: 'rounded',
      layout: 'grid',
    });
    expect(useWmStore.getState().windows.some((w) => w.id === win.id)).toBe(false);
  });

  it('keeps the changes on Save, and closes', async () => {
    const { win } = openEditor();

    fireEvent.click(screen.getByLabelText('capsule'));
    await waitFor(() => expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { shape: 'capsule' }));

    fireEvent.click(screen.getByText('Save folder'));

    // Save writes nothing of its own: every control already did. It must not revert either.
    expect(fakeApi.updateFolder).toHaveBeenLastCalledWith('f1', { shape: 'capsule' });
    expect(useWmStore.getState().windows.some((w) => w.id === win.id)).toBe(false);
  });

  it('commits a typed name on Enter', () => {
    openEditor();
    const input = screen.getByPlaceholderText('Untitled folder') as HTMLInputElement;
    // Focused first: Enter commits by blurring, and `blur()` on an unfocused input does nothing -
    // which is exactly the path a real keystroke takes.
    input.focus();
    fireEvent.change(input, { target: { value: 'Shooters' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fakeApi.updateFolder).toHaveBeenCalledWith('f1', { label: 'Shooters' });
  });

  it('says so when the folder is deleted under it', () => {
    useDesktopStore.setState({ folders: [] });
    openEditor();
    expect(screen.getByText('That folder is gone')).toBeDefined();
  });
});
