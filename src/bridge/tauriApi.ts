import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

import type { AuraApi } from './api';

const FILTERS = {
  exe: [{ name: 'Programs', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }],
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
  video: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'mov', 'm4v'] }],
  any: [] as { name: string; extensions: string[] }[],
};

export const tauriApi: AuraApi = {
  getAppInfo: () => invoke('get_app_info'),
  getSettings: () => invoke('get_settings'),
  updateSettings: (patch) => invoke('update_settings', { patch }),

  listEntries: (filter) => invoke('list_entries', { filter: filter ?? null }),
  getEntry: (id) => invoke('get_entry', { id }),
  addManualEntry: (input) => invoke('add_manual_entry', { input }),
  updateEntry: (id, patch) => invoke('update_entry', { id, patch }),
  removeEntry: (id) => invoke('remove_entry', { id }),
  scanLibrary: (sources) => invoke('scan_library', { sources: sources ?? null }),

  fetchArtwork: (entryId, force) => invoke('fetch_artwork', { entryId, force: force ?? false }),
  setArtworkOverride: (entryId, kind, path) =>
    invoke('set_artwork_override', { entryId, kind, path }),

  launchEntry: (id) => invoke('launch_entry', { id }),
  activeSessions: () => invoke('active_sessions'),

  listThemes: () => invoke('list_themes'),
  getTheme: (id) => invoke('get_theme', { id: id ?? null }),
  setActiveTheme: (id) => invoke('set_active_theme', { id }),

  getMonitors: () => invoke('get_monitors'),
  setFullscreen: (fullscreen) => invoke('set_fullscreen', { fullscreen }),
  shellReady: () => invoke('shell_ready'),
  exitShell: () => invoke('exit_shell'),
  minimizeShell: () => invoke('minimize_shell'),

  pickFile: async (kind) => {
    const picked = await open({ multiple: false, directory: false, filters: FILTERS[kind] });
    return typeof picked === 'string' ? picked : null;
  },
};
