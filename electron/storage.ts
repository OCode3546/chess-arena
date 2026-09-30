import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { migrate, type Migration } from '@shared/migrate';
import {
  DEFAULT_SETTINGS,
  type GameRecord,
  type LoadResult,
  type ProfilesDoc,
  type SavedGame,
  type Settings,
} from '@shared/types';
import {
  isGameRecord,
  isSavedGame,
  MAX_HISTORY,
  resetProfileProgress,
  sanitizeProfilesDoc,
  sanitizeSettings,
} from '@shared/validate';
import type { BackupData } from './backup';
import { SCHEMA_VERSION, storageMigrations } from './migrations';

type Doc = Record<string, unknown>;

const startupIssues: string[] = [];
let settingsStore: Store<Doc>;
let saveStore: Store<Doc>;
let profileStore: Store<Doc>;
let historyStore: Store<Doc>;
/** Set when the save file was unreadable; reported once to the renderer. */
let saveCorrupt = false;

/**
 * Open a JSON store. If the file is not valid JSON it is moved aside
 * (`<name>.corrupt-<timestamp>.json`) and a fresh store is created — never crash.
 */
function openStore(name: string, migrations: Record<number, Migration>): Store<Doc> {
  const create = () =>
    new Store<Doc>({ name, clearInvalidConfig: false, accessPropertiesByDotNotation: false });
  let store: Store<Doc>;
  try {
    store = create();
  } catch {
    const file = join(app.getPath('userData'), `${name}.json`);
    if (existsSync(file))
      renameSync(file, join(app.getPath('userData'), `${name}.corrupt-${Date.now()}.json`));
    startupIssues.push(name);
    store = create();
  }
  const { data, changed } = migrate({ ...store.store }, migrations, SCHEMA_VERSION);
  if (changed) store.store = data;
  return store;
}

export function initStorage(): void {
  const migrations = storageMigrations();
  settingsStore = openStore('settings', migrations.settings);
  saveStore = openStore('savegame', migrations.savegame);
  profileStore = openStore('profiles', migrations.profiles);
  historyStore = openStore('history', migrations.history);
  if (startupIssues.includes('savegame')) saveCorrupt = true;
}

export function getStartupIssues(): string[] {
  return [...startupIssues];
}

export function getSettings(): Settings {
  return sanitizeSettings(settingsStore.get('settings'), DEFAULT_SETTINGS);
}

export function setSettings(patch: unknown): Settings {
  const next = sanitizeSettings(patch, getSettings());
  settingsStore.set('settings', next);
  return next;
}

export function getSavedGame(): LoadResult<SavedGame> {
  if (saveCorrupt) {
    saveCorrupt = false;
    return { ok: false, error: 'corrupt' };
  }
  const game = saveStore.get('game');
  if (game === null || game === undefined) return { ok: true, data: null };
  if (!isSavedGame(game)) {
    saveStore.set('game', null);
    return { ok: false, error: 'corrupt' };
  }
  return { ok: true, data: game };
}

export function setSavedGame(game: unknown): boolean {
  if (!isSavedGame(game)) return false;
  saveStore.set('game', game);
  return true;
}

export function clearSavedGame(): void {
  saveStore.set('game', null);
}

export function getProfiles(): ProfilesDoc {
  return sanitizeProfilesDoc(profileStore.store);
}

export function setProfiles(doc: unknown): ProfilesDoc {
  const next = sanitizeProfilesDoc(doc);
  profileStore.set('activeId', next.activeId);
  profileStore.set('profiles', next.profiles);
  return next;
}

/** Finished games, newest first; unreadable entries are skipped. */
export function getHistory(): GameRecord[] {
  const games = historyStore.get('games');
  return Array.isArray(games) ? games.filter(isGameRecord) : [];
}

export function addGameRecord(record: unknown): boolean {
  if (!isGameRecord(record)) return false;
  const games = getHistory().filter((g) => g.id !== record.id);
  historyStore.set('games', [record, ...games].slice(0, MAX_HISTORY));
  return true;
}

export function getGameRecord(id: string): GameRecord | undefined {
  return getHistory().find((g) => g.id === id);
}

export function getBackupData(): BackupData {
  return { settings: getSettings(), profiles: getProfiles(), history: getHistory() };
}

/** Replace settings, profiles and history with already-validated imported data. */
export function replaceAllData(data: BackupData): void {
  settingsStore.set('settings', sanitizeSettings(data.settings));
  setProfiles(data.profiles);
  historyStore.set('games', data.history.filter(isGameRecord).slice(0, MAX_HISTORY));
}

export function resetProgress(): ProfilesDoc {
  const doc = getProfiles();
  const next = setProfiles({ ...doc, profiles: doc.profiles.map(resetProfileProgress) });
  historyStore.set('games', []);
  clearSavedGame();
  return next;
}
