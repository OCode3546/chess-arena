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
  sanitizeProfilesDoc,
  sanitizeSettings,
} from '@shared/validate';

const SCHEMA_VERSION = 1;

/** Keyed by the schema version they upgrade *to*. */
const settingsMigrations: Record<number, Migration> = {
  1: (d) => ({ ...d, settings: sanitizeSettings(d.settings) }),
};
const saveMigrations: Record<number, Migration> = {
  1: (d) => ({ ...d, game: d.game ?? null }),
};
const profileMigrations: Record<number, Migration> = {
  1: (d) => ({ ...d, ...sanitizeProfilesDoc(d) }),
};
const historyMigrations: Record<number, Migration> = {
  1: (d) => ({ ...d, games: Array.isArray(d.games) ? d.games.filter(isGameRecord) : [] }),
};

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
  settingsStore = openStore('settings', settingsMigrations);
  saveStore = openStore('savegame', saveMigrations);
  profileStore = openStore('profiles', profileMigrations);
  historyStore = openStore('history', historyMigrations);
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
