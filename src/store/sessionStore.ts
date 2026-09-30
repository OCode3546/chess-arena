import { create } from 'zustand';
import type { SavedGame } from '@shared/types';
import { setGamePersistence, useGameStore } from './gameStore';
import { toast } from './toastStore';

interface SessionState {
  /** Saved in-progress game on disk, if any. */
  savedGame: SavedGame | null;
  /** Placeholder local profile until multi-profile support lands. */
  profile: { name: string; avatarId: string; level: number; xp: number; xpToNext: number };
  refreshSavedGame(): Promise<void>;
  /** Load the saved game into the game store. Returns false (and toasts) if unusable. */
  continueSavedGame(): Promise<boolean>;
}

const CORRUPT_MESSAGE = 'Your saved game could not be read and was discarded.';

export const useSession = create<SessionState>()((set, get) => ({
  savedGame: null,
  profile: { name: 'Player', avatarId: 'knight-indigo', level: 1, xp: 0, xpToNext: 100 },

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
