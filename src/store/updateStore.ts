import { create } from 'zustand';
import type { UpdaterInfo } from '@shared/types';
import { useGameStore } from './gameStore';

interface UpdateStoreState {
  info: UpdaterInfo;
  /** The user closed the Home banner for this version. */
  dismissedVersion: string | null;
  dismiss(version: string): void;
}

export const useUpdates = create<UpdateStoreState>()((set) => ({
  info: { mode: 'none', state: { status: 'idle' }, releasesUrl: '' },
  dismissedVersion: null,
  dismiss: (version) => set({ dismissedVersion: version }),
}));

/** Load the updater state and follow its changes. Returns the unsubscribe function. */
export function wireUpdates(): () => void {
  const api = window.chessArena.updater;
  void api.getInfo().then((info) => useUpdates.setState({ info }));
  return api.onChange((info) => useUpdates.setState({ info }));
}

/** Save a running game, then quit and install the downloaded update. */
export function installUpdate(): void {
  const game = useGameStore.getState();
  if (game.status === 'playing') game.persist(Date.now());
  window.chessArena.updater.install();
}

/** Open the download page in the browser (for builds that cannot update themselves). */
export function openReleasesPage(): void {
  const url = useUpdates.getState().info.releasesUrl;
  if (url) window.open(url, '_blank');
}
