import { create } from 'zustand';
import type { SavedGame } from '@shared/types';
import { setGamePersistence, useGameStore } from './gameStore';
import { setProfilePersistence, useProfiles } from './profileStore';
import { toast } from './toastStore';

interface SessionState {
  /** Saved in-progress game on disk, if any. */
  savedGame: SavedGame | null;
  refreshSavedGame(): Promise<void>;
  /** Load the saved game into the game store. Returns false (and toasts) if unusable. */
  continueSavedGame(): Promise<boolean>;
}

const CORRUPT_MESSAGE = 'Your saved game could not be read and was discarded.';

export const useSession = create<SessionState>()((set, get) => ({
  savedGame: null,

  async refreshSavedGame() {
    const res = await window.chessArena.storage.getSavedGame();
    if (!res.ok) {
      toast(CORRUPT_MESSAGE, 'warning');
      await window.chessArena.storage.clearSavedGame();
      set({ savedGame: null });
      return;
    }
    set({ savedGame: res.data });
  },

  async continueSavedGame() {
    await get().refreshSavedGame();
    const saved = get().savedGame;
    if (!saved) return false;
    if (!useGameStore.getState().restore(saved)) {
      toast(CORRUPT_MESSAGE, 'warning');
      await window.chessArena.storage.clearSavedGame();
      set({ savedGame: null });
      return false;
    }
    return true;
  },
}));

/** Connect the game store's auto-save to the main process. */
export function wireGamePersistence(): void {
  setGamePersistence({
    save: (game) => {
      useSession.setState({ savedGame: game });
      void window.chessArena.storage.setSavedGame(game);
    },
    clear: () => {
      useSession.setState({ savedGame: null });
      void window.chessArena.storage.clearSavedGame();
    },
  });
}

/** Connect profiles and match history to the main process, and load the profiles. */
export async function loadProfiles(): Promise<void> {
  setProfilePersistence({
    saveProfiles: (doc) => {
      void window.chessArena.storage.setProfiles(doc).catch((err) => {
        console.error(err);
        toast('Your profile could not be saved.', 'error');
      });
    },
    addRecord: (record) => {
      void window.chessArena.storage.addGameRecord(record).catch((err) => console.error(err));
    },
  });
  useProfiles.getState().hydrate(await window.chessArena.storage.getProfiles());
}
