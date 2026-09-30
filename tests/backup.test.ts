import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, createBackup, readBackup, type BackupData } from '../electron/backup';
import { SCHEMA_VERSION } from '../electron/migrations';
import { DEFAULT_SETTINGS, type GameRecord, type Profile } from '@shared/types';
import { resetProfileProgress, sanitizeProfile } from '@shared/validate';

const profile: Profile = sanitizeProfile({
  id: 'p1',
  name: 'Ana',
  avatarId: 'pawn-sky',
  level: 12,
  xp: 7000,
  createdAt: '2026-09-01T10:00:00.000Z',
  stats: { played: 20, wins: 12, draws: 3, losses: 5, streak: 2, bestStreak: 6, fastestMate: 9 },
  pvpToday: { guest: { date: '2026-09-30', count: 2 } },
  equipped: {
    board: 'emerald',
    pieceSet: 'classic',
    frame: 'hard',
    effects: [],
    title: 'pawn-pusher',
  },
  achievements: { 'first-win': '2026-09-02T10:00:00.000Z' },
})!;

const game: GameRecord = {
  id: 'g1',
  date: '2026-09-30T12:00:00.000Z',
  mode: 'pvp',
  white: 'p1',
  black: 'guest',
  whiteName: 'Ana',
  blackName: 'Guest',
  pgn: '1. f3 e5 2. g4 Qh4# 0-1',
  result: '0-1',
  reason: 'checkmate',
  moves: 2,
  xpAwarded: { p1: 0 },
};

const data: BackupData = {
  settings: { ...DEFAULT_SETTINGS, theme: 'light', volume: 0.35, sound: false },
  profiles: { activeId: 'p1', profiles: [profile] },
  history: [game],
};

/** What actually lands on disk and comes back. */
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

describe('data backup', () => {
  it('exports everything with the format, schema and app version', () => {
    const b = createBackup(data, '0.7.0', new Date('2026-09-30T12:00:00Z'));
    expect(b).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: '0.7.0',
      exportedAt: '2026-09-30T12:00:00.000Z',
    });
  });

  it('re-imports exactly what was exported', () => {
    const res = readBackup(roundTrip(createBackup(data, '0.7.0')));
    expect(res).toEqual({ ok: true, data });
  });

  it.each([
    ['not an object', 'hello'],
    ['another format', { ...createBackup(data, '0.7.0'), format: 'something-else' }],
    ['no schema version', { ...createBackup(data, '0.7.0'), schemaVersion: undefined }],
    ['no profiles', { ...createBackup(data, '0.7.0'), profiles: undefined }],
    ['history not a list', { ...createBackup(data, '0.7.0'), history: {} }],
  ])('rejects %s', (_n, value) => {
    expect(readBackup(roundTrip(value))).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses backups from a newer schema', () => {
    const newer = { ...createBackup(data, '9.0.0'), schemaVersion: SCHEMA_VERSION + 1 };
    expect(readBackup(newer)).toEqual({ ok: false, error: 'newer' });
  });

  it('drops invalid entries and sanitises the rest', () => {
    const res = readBackup({
      ...(roundTrip(createBackup(data, '0.7.0')) as object),
      settings: { theme: 'neon', volume: 9, sound: false },
      profiles: { activeId: 'nobody', profiles: [{ id: '../x', name: 'Bad' }, profile] },
      history: [game, { ...game, id: 'g2', result: 'win' }, 'junk'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.settings).toEqual({ ...DEFAULT_SETTINGS, volume: 1, sound: false });
    expect(res.data.profiles).toEqual({ activeId: 'p1', profiles: [profile] });
    expect(res.data.history).toEqual([game]);
  });

  it('migrates a schema v1 backup (board and pieces move onto the profiles)', () => {
    const { equipped: _equipped, achievements: _a, ...v1Profile } = profile;
    const res = readBackup({
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      appVersion: '0.5.0',
      exportedAt: '2026-09-20T10:00:00.000Z',
      settings: { ...DEFAULT_SETTINGS, board: 'slate', pieceSet: 'classic' },
      profiles: { activeId: 'p1', profiles: [v1Profile] },
      history: [game],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(res.data.profiles.profiles[0]!.equipped).toEqual({
      board: 'slate',
      pieceSet: 'classic',
      frame: 'none',
      effects: [],
    });
    expect(res.data.profiles.profiles[0]!.xp).toBe(7000);
  });
});

describe('reset progress', () => {
  it('keeps who the profile is and clears everything earned', () => {
    const reset = resetProfileProgress(profile);
    expect(reset).toMatchObject({
      id: 'p1',
      name: 'Ana',
      avatarId: 'pawn-sky',
      createdAt: profile.createdAt,
      level: 1,
      xp: 0,
      pvpToday: {},
      achievements: {},
      equipped: { board: 'classic-wood', pieceSet: 'modern', frame: 'none', effects: [] },
    });
    expect(reset.stats).toMatchObject({ played: 0, wins: 0, streak: 0, bestStreak: 0 });
    expect(reset.stats.fastestMate).toBeUndefined();
    expect(reset.equipped.title).toBeUndefined();
  });
});
