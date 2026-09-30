import { migrate } from '@shared/migrate';
import type { GameRecord, ProfilesDoc, Settings } from '@shared/types';
import { isGameRecord, MAX_HISTORY, sanitizeProfilesDoc, sanitizeSettings } from '@shared/validate';
import { SCHEMA_VERSION, storageMigrations } from './migrations';

export const BACKUP_FORMAT = 'chess-arena-backup';

export interface BackupData {
  settings: Settings;
  profiles: ProfilesDoc;
  history: GameRecord[];
}

/** The exported file: everything a player owns, stamped with the schema it was written in. */
export interface Backup extends BackupData {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
}

export function createBackup(data: BackupData, appVersion: string, now = new Date()): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    ...data,
  };
}

export type ReadBackupResult =
  { ok: true; data: BackupData } | { ok: false; error: 'invalid' | 'newer' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate an imported backup and bring it up to the current schema with the same
 * migrations the stores use. Every field is sanitised; unreadable games are dropped.
 */
export function readBackup(input: unknown): ReadBackupResult {
  if (!isObj(input) || input.format !== BACKUP_FORMAT) return { ok: false, error: 'invalid' };
  const from = input.schemaVersion;
  if (!Number.isInteger(from) || (from as number) < 0) return { ok: false, error: 'invalid' };
  if ((from as number) > SCHEMA_VERSION) return { ok: false, error: 'newer' };
  if (!isObj(input.profiles) || !Array.isArray(input.history)) {
    return { ok: false, error: 'invalid' };
  }
  // Settings first: the v2 profile migration reads the look chosen in the old settings.
  const m = storageMigrations();
  const up = (doc: Obj, steps: typeof m.settings) =>
    migrate({ ...doc, schemaVersion: from }, steps, SCHEMA_VERSION).data;
  const settings = up({ settings: input.settings }, m.settings);
  const profiles = up(input.profiles, m.profiles);
  const history = up({ games: input.history }, m.history);
  const games = Array.isArray(history.games) ? history.games.filter(isGameRecord) : [];
  return {
    ok: true,
    data: {
      settings: sanitizeSettings(settings.settings),
      profiles: sanitizeProfilesDoc(profiles),
      history: games.slice(0, MAX_HISTORY),
    },
  };
}
