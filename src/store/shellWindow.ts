/**
 * The shell's own native window, as the UI sees it.
 *
 * Every change goes through a command - the UI never calls `@tauri-apps/api/window` - so the
 * rules about topmost, size and the remembered preference stay in `shell_host::window`, and all
 * of it works against the browser mock.
 */

import { create } from 'zustand';

import { api } from '@/bridge';
import type { ShellWindowState } from '@/bridge';

import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

export interface ShellWindowStore {
  /** Null until the host has answered once. */
  state: ShellWindowState | null;
  refresh(): Promise<void>;
}

export const useShellWindow = create<ShellWindowStore>()((set) => ({
  state: null,
  async refresh() {
    try {
      set({ state: await api.getWindowState() });
    } catch {
      // An older host without the command: keep whatever was known.
    }
  },
}));

/**
 * F11: flip fullscreen and remember it.
 *
 * The host both applies and persists the choice, so Settings is re-read afterwards - otherwise
 * the Fullscreen row would show the old value until something else reloaded it.
 */
export async function toggleShellFullscreen(): Promise<void> {
  try {
    const current = useShellWindow.getState().state ?? (await api.getWindowState());
    await api.setFullscreen(!current.fullscreen);
    await Promise.all([useShellWindow.getState().refresh(), useSettingsStore.getState().load()]);
  } catch {
    useUiStore.getState().pushToast('error', 'Could not change fullscreen');
  }
}

/** The title bar's middle button: maximise or restore the windowed shell. */
export async function toggleShellMaximize(): Promise<void> {
  try {
    useShellWindow.setState({ state: await api.toggleMaximizeShell() });
  } catch {
    useUiStore.getState().pushToast('error', 'Could not maximise the window');
  }
}
