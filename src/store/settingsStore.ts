import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<Settings>): void;
}

/** Settings mirror the copy persisted by the main process (electron-store). */
export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const settings = await window.chessArena.storage.getSettings();
    set({ settings, loaded: true });
  },
  update(patch) {
    set({ settings: { ...get().settings, ...patch } });
    void window.chessArena.storage.setSettings(patch).then((settings) => set({ settings }));
  },
}));
