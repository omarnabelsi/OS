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
  listDesktops: () => invoke('list_desktops'),
  getDesktop: (id) => invoke('get_desktop', { id }),
  createDesktop: (name) => invoke('create_desktop', { name }),
  updateDesktop: (desktop) => invoke('update_desktop', { desktop }),
  deleteDesktop: (id) => invoke('delete_desktop', { id }),
  listDesktopItems: (desktopId) => invoke('list_desktop_items', { desktopId }),
  addDesktopItem: (input) => invoke('add_desktop_item', { input }),
  updateDesktopItem: (id, patch) => invoke('update_desktop_item', { id, patch }),
  removeDesktopItem: (id) => invoke('remove_desktop_item', { id }),

  listFolders: () => invoke('list_folders'),
  getFolder: (id) => invoke('get_folder', { id }),
  createFolder: (input) => invoke('create_folder', { input }),
  updateFolder: (id, patch) => invoke('update_folder', { id, patch }),
  setFolderCover: (id, path) => invoke('set_folder_cover', { id, path }),
  setFolderIcon: (id, path) => invoke('set_folder_icon', { id, path }),
  deleteFolder: (id) => invoke('delete_folder', { id }),
  folderContents: (id) => invoke('folder_contents', { id }),

  listTaskbarItems: () => invoke('list_taskbar_items'),
  pinToTaskbar: (targetId) => invoke('pin_to_taskbar', { targetId }),
  unpinFromTaskbar: (targetId) => invoke('unpin_from_taskbar', { targetId }),
  reorderTaskbar: (ids) => invoke('reorder_taskbar', { ids }),
  getSystemStatus: () => invoke('get_system_status'),

  getExitHotkeyStatus: () => invoke('get_exit_hotkey_status'),
  setFullscreen: (fullscreen) => invoke('set_fullscreen', { fullscreen }),
  shellReady: () => invoke('shell_ready'),
  exitShell: () => invoke('exit_shell'),
  minimizeShell: () => invoke('minimize_shell'),
  getWindowState: () => invoke('get_window_state'),
  toggleMaximizeShell: () => invoke('toggle_maximize_shell'),

  pickFile: async (kind) => {
    const picked = await open({ multiple: false, directory: false, filters: FILTERS[kind] });
    return typeof picked === 'string' ? picked : null;
  },
};
