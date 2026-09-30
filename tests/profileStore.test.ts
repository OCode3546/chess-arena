import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameRecord, GameSettings, ProfilesDoc } from '@shared/types';
import { setGamePersistence, useGameStore } from '@/store/gameStore';
import { setProfilePersistence, useProfiles, wireProgression } from '@/store/profileStore';

const game = () => useGameStore.getState();
const profiles = () => useProfiles.getState();

let savedDocs: ProfilesDoc[] = [];
let records: GameRecord[] = [];
const unwire = wireProgression();
afterAll(unwire);

beforeEach(() => {
  savedDocs = [];
  records = [];
  setGamePersistence(null);
  setProfilePersistence({
    saveProfiles: (doc) => savedDocs.push(structuredClone(doc)),
    addRecord: (r) => records.push(r),
  });
  game().reset();
  useProfiles.setState({ profiles: [], activeId: null, lastMatch: null, loaded: true });
});

const pvp = (w: string | undefined, b: string | undefined): GameSettings => ({
  mode: 'pvp',
  timeControl: { id: 'untimed', initialMs: 0, incrementMs: 0 },
  players: { w: { name: 'W', profileId: w }, b: { name: 'B', profileId: b } },
  autoFlip: false,
});

describe('profile store', () => {
  it('creates, switches, edits and deletes profiles and persists each change', () => {
    const a = profiles().create('Ana', 'knight-indigo')!;
    const b = profiles().create('Ben', 'rook-emerald')!;
    expect(profiles().activeId).toBe(b);
    profiles().setActive(a);
    profiles().update(b, { name: 'Benny' });
    expect(profiles().profiles.map((p) => p.name)).toEqual(['Ana', 'Benny']);
    profiles().remove(a);
    expect(profiles().activeId).toBe(b);
    expect(savedDocs.at(-1)).toEqual({ activeId: b, profiles: profiles().profiles });
    expect(savedDocs).toHaveLength(5);
  });

  it('derives levels from XP when hydrating', () => {
    const id = profiles().create('Ana', 'knight-indigo')!;
    const p = { ...profiles().profiles[0]!, xp: 250, level: 40 };
    profiles().hydrate({ activeId: id, profiles: [p] });
    expect(profiles().profiles[0]!.level).toBe(3);
  });

  it('settles a finished game exactly once and records it', () => {
    const a = profiles().create('Ana', 'knight-indigo')!;
    const b = profiles().create('Ben', 'rook-emerald')!;
    game().newGame(pvp(a, b));
    const line =
      'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 h2h3 h7h6 a2a4 a7a5 f1e1 f8e8 b1d2 c8e6';
    for (const m of line.split(' ')) {
      expect(game().attemptMove(m.slice(0, 2) as never, m.slice(2) as never)).toBe('moved');
    }
    game().resign('w');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ moves: 10, result: '0-1', reason: 'resignation' });
    const match = profiles().lastMatch!;
    expect(match.gameId).toBe(game().startedAt);
    const xp = Object.fromEntries(match.awards.map((x) => [x.profileId, x.award.total]));
    expect(xp).toEqual({ [a]: 15, [b]: 60 });
    expect(records[0]!.xpAwarded).toEqual(xp);
    expect(profiles().profiles.map((p) => p.xp)).toEqual([15, 60]);
    expect(savedDocs.at(-1)!.profiles.map((p) => p.xp)).toEqual([15, 60]);

    profiles().settleFinishedGame();
    expect(records).toHaveLength(1);
    expect(profiles().profiles.map((p) => p.xp)).toEqual([15, 60]);
  });

  it('gives no XP for a short local game ended by repetition', () => {
    const a = profiles().create('Ana', 'knight-indigo')!;
    const b = profiles().create('Ben', 'rook-emerald')!;
    game().newGame(pvp(a, b));
    for (const m of 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'.split(' ')) {
      game().attemptMove(m.slice(0, 2) as never, m.slice(2) as never);
    }
    expect(game().result?.reason).toBe('threefold');
    expect(records[0]!.moves).toBe(4);
    expect(profiles().lastMatch!.awards.map((x) => x.award.total)).toEqual([0, 0]);
  });

  it('awards XP when a player resigns and ignores guests', () => {
    const a = profiles().create('Ana', 'knight-indigo')!;
    game().newGame(pvp(a, undefined));
    game().resign('b');
    expect(records).toHaveLength(1);
    expect(records[0]!.black).toBe('guest');
    // Resigned before move 5: counted, but no XP.
    const ana = profiles().profiles[0]!;
    expect(ana.xp).toBe(0);
    expect(ana.stats.wins).toBe(1);
  });
});
