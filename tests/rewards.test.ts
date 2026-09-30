import { beforeEach, describe, expect, it } from 'vitest';
import type { GameSettings, Profile, ProfilesDoc } from '@shared/types';
import { sanitizeProfile } from '@shared/validate';
import { ACHIEVEMENTS } from '@/config/achievements';
import { AVATARS } from '@/config/avatars';
import { BOARD_THEMES } from '@/config/boards';
import { PIECE_SETS } from '@/config/pieces';
import { MAX_LEVEL } from '@/config/progression';
import {
  badgeTier,
  cosmeticsFor,
  EFFECTS,
  FRAMES,
  isUnlocked,
  REWARDS,
  rewardsAt,
  TITLES,
  unlockedAt,
  unlocksBetween,
} from '@/config/rewards';
import { draw, win, type GameResult } from '@/game/rules';
import { newAchievements } from '@/progression/achievements';
import { xpForLevel } from '@/progression/levels';
import { emptyStats, newProfile, settleMatch, type FinishedGame } from '@/progression/match';
import { setProfilePersistence, useProfiles } from '@/store/profileStore';

const NOW = new Date(2026, 8, 30, 15, 0, 0);

const profile = (name: string, over: Partial<Profile> = {}): Profile => ({
  ...newProfile(name, 'knight-indigo', NOW),
  ...over,
});
const atLevel = (level: number, over: Partial<Profile> = {}) =>
  profile('Ana', { level, xp: xpForLevel(level), ...over });

const keys = (list: { kind: string; id: string }[]) => list.map((r) => `${r.kind}:${r.id}`);

describe('reward table', () => {
  it('lists every reward exactly once', () => {
    const all = keys(REWARDS);
    expect(new Set(all).size).toBe(all.length);
  });

  it('matches the spec’s level table', () => {
    const boards = Object.fromEntries(
      REWARDS.filter((r) => r.kind === 'board').map((r) => [r.id, r.level]),
    );
    expect(boards).toEqual({
      'classic-wood': 1,
      slate: 3,
      emerald: 8,
      midnight: 15,
      neon: 25,
      marble: 35,
    });
    const titles = REWARDS.filter((r) => r.kind === 'title').map((r) => [r.level, r.name]);
    expect(titles).toEqual([
      [5, 'Pawn Pusher'],
      [10, 'Knight Errant'],
      [20, 'Bishop’s Gambit'],
      [30, 'Rook Commander'],
      [40, 'Queen’s Guard'],
      [45, 'Grandmaster Candidate'],
      [50, 'Chess Legend'],
    ]);
    expect(keys(rewardsAt(1)).sort()).toEqual(
      [
        'board:classic-wood',
        'pieceSet:modern',
        'pieceSet:classic',
        ...AVATARS.filter((a) => a.pack === 'starter').map((a) => `avatar:${a.id}`),
      ].sort(),
    );
    expect(rewardsAt(1).filter((r) => r.kind === 'avatar')).toHaveLength(4);
    expect(rewardsAt(5).filter((r) => r.kind === 'avatar').length).toBeGreaterThan(0);
    expect(keys(rewardsAt(10))).toContain('frame:hard');
    expect(keys(rewardsAt(20))).toContain('effect:move-trail');
    expect(rewardsAt(20).filter((r) => r.kind === 'avatar').length).toBeGreaterThan(0);
    expect(keys(rewardsAt(30))).toContain('frame:gold');
    expect(keys(rewardsAt(40))).toContain('effect:capture-particles');
    expect(keys(rewardsAt(45))).toContain('frame:animated');
    expect(keys(rewardsAt(50))).toEqual(
      expect.arrayContaining(['title:chess-legend', 'avatar:king-legend', 'frame:rainbow']),
    );
  });

  it('makes every cosmetic obtainable', () => {
    const all = new Set(keys(REWARDS));
    for (const b of BOARD_THEMES) expect(all).toContain(`board:${b.id}`);
    for (const p of PIECE_SETS) expect(all).toContain(`pieceSet:${p.id}`);
    for (const a of AVATARS) expect(all).toContain(`avatar:${a.id}`);
    for (const t of Object.keys(TITLES)) expect(all).toContain(`title:${t}`);
    for (const f of Object.keys(FRAMES)) if (f !== 'none') expect(all).toContain(`frame:${f}`);
    for (const e of Object.keys(EFFECTS)) expect(all).toContain(`effect:${e}`);
    expect(REWARDS.every((r) => r.level >= 1 && r.level <= MAX_LEVEL)).toBe(true);
  });

  it('derives unlocks from the level without duplicates', () => {
    let prev = 0;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const got = keys(unlockedAt(level));
      expect(new Set(got).size).toBe(got.length);
      expect(got.length).toBeGreaterThanOrEqual(prev);
      prev = got.length;
    }
    expect(unlockedAt(MAX_LEVEL)).toHaveLength(REWARDS.length);
    expect(isUnlocked('board', 'slate', 2)).toBe(false);
    expect(isUnlocked('board', 'slate', 3)).toBe(true);
    expect(isUnlocked('frame', 'none', 1)).toBe(true);
    expect(isUnlocked('board', 'no-such-board', 50)).toBe(false);
  });

  it('catches up on every level of a multi-level jump', () => {
    expect(keys(unlocksBetween(4, 11))).toEqual(
      keys([...rewardsAt(5), ...rewardsAt(8), ...rewardsAt(10)]),
    );
    expect(unlocksBetween(7, 7)).toEqual([]);
    expect(unlocksBetween(6, 7)).toEqual([]);
    expect(keys(unlocksBetween(49, 999))).toEqual(keys(rewardsAt(50)));
  });

  it('assigns badge tiers', () => {
    expect(badgeTier(1).id).toBe('rookie');
    expect(badgeTier(9).id).toBe('rookie');
    expect(badgeTier(10).id).toBe('bronze');
    expect(badgeTier(49).id).toBe('platinum');
    expect(badgeTier(50).id).toBe('legend');
  });
});

describe('cosmetics', () => {
  it('uses the defaults without a profile', () => {
    expect(cosmeticsFor(null)).toEqual({
      board: 'classic-wood',
      pieceSet: 'modern',
      frame: 'none',
      effects: [],
      avatarId: 'knight-indigo',
    });
  });

  it('keeps unlocked items and drops locked ones', () => {
    const equipped = {
      board: 'neon',
      pieceSet: 'classic',
      frame: 'gold',
      title: 'knight-errant',
      effects: ['move-trail', 'capture-particles'],
    };
    expect(cosmeticsFor(atLevel(30, { equipped, avatarId: 'pawn-gold' }))).toEqual({
      ...equipped,
      effects: ['move-trail'],
      avatarId: 'pawn-gold',
    });
    // A hand-edited file cannot show items above the profile's level.
    expect(cosmeticsFor(atLevel(4, { equipped, avatarId: 'king-legend' }))).toEqual({
      board: 'classic-wood',
      pieceSet: 'classic',
      frame: 'none',
      effects: [],
      avatarId: 'knight-indigo',
    });
  });

  it('validates stored cosmetics structurally', () => {
    const p = sanitizeProfile({
      ...atLevel(3),
      equipped: { board: '../x', pieceSet: 'classic', effects: ['move-trail', 'move-trail', 5] },
      achievements: { 'first-win': NOW.toISOString(), bad: 'yesterday', '../x': NOW.toISOString() },
    })!;
    expect(p.equipped).toEqual({
      board: 'classic-wood',
      pieceSet: 'classic',
      frame: 'none',
      effects: ['move-trail'],
    });
    expect(p.achievements).toEqual({ 'first-win': NOW.toISOString() });
    const fresh = atLevel(3, { achievements: { 'first-win': NOW.toISOString() } });
    expect(sanitizeProfile(fresh)).toEqual(fresh);
  });
});

// ---------- achievements ----------

const aiSettings = (p: Profile, over: Partial<GameSettings> = {}): GameSettings => ({
  mode: 'pvai',
  timeControl: { id: 'untimed', initialMs: 0, incrementMs: 0 },
  players: { w: { name: p.name, profileId: p.id }, b: { name: 'Stockfish' } },
  autoFlip: false,
  difficulty: 'medium',
  humanColor: 'w',
  ...over,
});

const game = (settings: GameSettings, result: GameResult, plies: number): FinishedGame => ({
  settings,
  result,
  history: Array.from({ length: plies }, (_, i) => ({ color: i % 2 === 0 ? 'w' : 'b' })),
  pgn: '',
  assists: { hints: 0, undos: 0 },
});

describe('achievements', () => {
  const ctx = (over = {}) => ({
    stats: emptyStats(),
    outcome: 'loss' as const,
    moves: 40,
    abandoned: false,
    ...over,
  });

  it('checks each rule', () => {
    expect(newAchievements({}, ctx())).toEqual([]);
    expect(newAchievements({}, ctx({ stats: { ...emptyStats(), wins: 1 } }))).toEqual([
      'first-win',
    ]);
    expect(newAchievements({}, ctx({ stats: { ...emptyStats(), bestStreak: 5 } }))).toEqual([
      'streak-5',
    ]);
    const gm = { ...emptyStats().winsByDifficulty, grandmaster: 1 };
    expect(newAchievements({}, ctx({ stats: { ...emptyStats(), winsByDifficulty: gm } }))).toEqual([
      'beat-grandmaster',
    ]);
    expect(newAchievements({}, ctx({ outcome: 'win', moves: 20 }))).toContain('quick-win');
    expect(newAchievements({}, ctx({ outcome: 'win', moves: 21 }))).not.toContain('quick-win');
    expect(newAchievements({}, ctx({ outcome: 'win', moves: 2, abandoned: true }))).not.toContain(
      'quick-win',
    );
    expect(newAchievements({}, ctx({ stats: { ...emptyStats(), played: 100 } }))).toEqual([
      'games-100',
    ]);
    expect(
      newAchievements(
        { 'games-100': NOW.toISOString() },
        ctx({ stats: { ...emptyStats(), played: 150 } }),
      ),
    ).toEqual([]);
    expect(ACHIEVEMENTS).toHaveLength(5);
  });

  it('are earned once through settlement', () => {
    const p = profile('Ana', {
      stats: { ...emptyStats(), played: 99, streak: 4, bestStreak: 4, wins: 4 },
    });
    const s = settleMatch(
      [p],
      game(aiSettings(p, { difficulty: 'grandmaster' }), win('w', 'checkmate'), 39),
      NOW,
    );
    // "First Victory" catches up for a profile that won before achievements existed.
    expect(s.awards[0]!.achievements.sort()).toEqual(
      ['beat-grandmaster', 'first-win', 'games-100', 'quick-win', 'streak-5'].sort(),
    );
    const after = s.profiles[0]!;
    expect(Object.keys(after.achievements).sort()).toEqual(s.awards[0]!.achievements.sort());
    expect(after.achievements['quick-win']).toBe(NOW.toISOString());

    const again = settleMatch([after], game(aiSettings(after), win('w', 'checkmate'), 30), NOW);
    expect(again.awards[0]!.achievements).toEqual([]);
  });

  it('includes a first win and nothing for a draw', () => {
    const p = profile('Ana');
    expect(
      settleMatch([p], game(aiSettings(p), draw('stalemate'), 80), NOW).awards[0]!.achievements,
    ).toEqual([]);
    expect(
      settleMatch([p], game(aiSettings(p), win('w', 'resignation'), 80), NOW).awards[0]!
        .achievements,
    ).toEqual(['first-win']);
  });

  it('reports every unlock of a multi-level jump', () => {
    const p = profile('Ana', { level: 2, xp: xpForLevel(2) });
    const s = settleMatch(
      [p],
      game(aiSettings(p, { difficulty: 'grandmaster' }), win('w', 'checkmate'), 39),
      NOW,
    );
    const a = s.awards[0]!;
    expect(a.after.level).toBeGreaterThanOrEqual(5);
    expect(keys(a.unlocks)).toEqual(keys(unlocksBetween(2, a.after.level)));
    expect(keys(a.unlocks)).toEqual(expect.arrayContaining(['board:slate', 'title:pawn-pusher']));
  });
});

// ---------- equipping ----------

describe('equipping', () => {
  let saved: ProfilesDoc[] = [];
  const store = () => useProfiles.getState();

  beforeEach(() => {
    saved = [];
    setProfilePersistence({
      saveProfiles: (doc) => saved.push(structuredClone(doc)),
      addRecord: () => {},
    });
    const p = atLevel(20);
    useProfiles.setState({ profiles: [p], activeId: p.id, lastMatch: null, loaded: true });
  });

  it('equips unlocked items and refuses locked ones', () => {
    expect(store().equip('board', 'midnight')).toBe(true);
    expect(store().equip('board', 'neon')).toBe(false);
    expect(store().equip('pieceSet', 'classic')).toBe(true);
    expect(store().equip('frame', 'hard')).toBe(true);
    expect(store().equip('frame', 'gold')).toBe(false);
    expect(store().equip('avatar', 'queen-aurora')).toBe(true);
    expect(store().equip('avatar', 'king-legend')).toBe(false);
    const p = store().profiles[0]!;
    expect(p.avatarId).toBe('queen-aurora');
    expect(p.equipped).toEqual({
      board: 'midnight',
      pieceSet: 'classic',
      frame: 'hard',
      effects: [],
    });
    expect(saved).toHaveLength(4);
    expect(saved.at(-1)!.profiles[0]).toEqual(p);
  });

  it('toggles titles and effects', () => {
    store().equip('title', 'pawn-pusher');
    store().equip('title', 'bishops-gambit');
    expect(store().profiles[0]!.equipped.title).toBe('bishops-gambit');
    store().equip('title', 'bishops-gambit', false);
    expect('title' in store().profiles[0]!.equipped).toBe(false);
    store().equip('effect', 'move-trail');
    store().equip('effect', 'move-trail');
    expect(store().profiles[0]!.equipped.effects).toEqual(['move-trail']);
    expect(store().equip('effect', 'capture-particles')).toBe(false);
    store().equip('effect', 'move-trail', false);
    expect(store().profiles[0]!.equipped.effects).toEqual([]);
  });

  it('survives a save/load round trip', () => {
    store().equip('board', 'emerald');
    store().equip('title', 'knight-errant');
    const doc = saved.at(-1)!;
    const reloaded = doc.profiles.map((p) => sanitizeProfile(JSON.parse(JSON.stringify(p)))!);
    store().hydrate({ activeId: doc.activeId, profiles: reloaded });
    expect(cosmeticsFor(store().profiles[0]!)).toMatchObject({
      board: 'emerald',
      title: 'knight-errant',
    });
  });

  it('does nothing without an active profile', () => {
    useProfiles.setState({ profiles: [], activeId: null });
    expect(store().equip('board', 'classic-wood')).toBe(false);
    expect(saved).toEqual([]);
  });
});
