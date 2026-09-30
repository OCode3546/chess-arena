import type { SaveFileResult } from '@shared/types';
import { useGameStore } from './gameStore';
import { useProfiles } from './profileStore';
import { useSession } from './sessionStore';
import { useSettings } from './settingsStore';
import { toast } from './toastStore';

/** File and data actions from Settings and History; each reports its outcome in a toast. */

function report(res: SaveFileResult, what: string): boolean {
  if (res.status === 'saved') toast(`${what} saved as “${res.fileName}”.`, 'success');
  if (res.status === 'error') toast(res.message, 'error');
  return res.status === 'saved';
}

const failed = (err: unknown) => {
  console.error(err);
  toast('Something went wrong. Please try again.', 'error');
  return false;
};

export function exportGamePgn(gameId: string): Promise<boolean> {
  return window.chessArena.dialog
    .exportPgn(gameId)
    .then((res) => report(res, 'Game'))
    .catch(failed);
}

export function exportData(): Promise<boolean> {
  return window.chessArena.dialog
    .exportData()
    .then((res) => report(res, 'Backup'))
    .catch(failed);
}

/** Replace profiles, history and settings with a backup's, then reload them. */
export async function importData(): Promise<boolean> {
  try {
    const res = await window.chessArena.dialog.importData();
    if (res.status === 'error') toast(res.message, 'error');
    if (res.status !== 'imported') return false;
    await useSettings.getState().load();
    useProfiles.setState({ lastMatch: null });
    useProfiles.getState().hydrate(await window.chessArena.storage.getProfiles());
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    toast(
      `Imported ${plural(res.profiles, 'profile')} and ${plural(res.games, 'game')}.`,
      'success',
    );
    return true;
  } catch (err) {
    return failed(err);
  }
}

/** Every profile back to level 1; history and the saved game are deleted. */
export async function resetProgress(): Promise<boolean> {
  try {
    const doc = await window.chessArena.storage.resetProgress();
    useGameStore.getState().reset();
    useSession.setState({ savedGame: null });
    useProfiles.setState({ lastMatch: null });
    useProfiles.getState().hydrate(doc);
    toast('Progress reset. Every profile starts again at level 1.', 'success');
    return true;
  } catch (err) {
    return failed(err);
  }
}
