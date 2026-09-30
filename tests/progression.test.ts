import { describe, expect, it } from 'vitest';
import type { GameSettings, Profile } from '@shared/types';
import { isGameRecord, sanitizeProfile, sanitizeProfilesDoc } from '@shared/validate';
import { AI_XP, MAX_LEVEL } from '@/config/progression';
import { draw, win, type GameResult } from '@/game/rules';
import { aiAward, isAbandoned, pvpAward, type AiAwardInput } from '@/progression/awards';
import { applyXp, levelForXp, levelProgress, xpForLevel, xpToNext } from '@/progression/levels';
import { localDay, newProfile, settleMatch, type FinishedGame } from '@/progression/match';

describe('level curve', () => {
  it('follows round(100 + 25(L−1) + 2.5(L−1)²)', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(128); // 100 + 25 + 2.5 = 127.5
    expect(xpToNext(10)).toBe(528); // 100 + 225 + 202.5
    expect(xpToNext(25)).toBe(2140);
    expect(xpToNext(49)).toBe(7060);
    for (let l = 1; l < MAX_LEVEL; l++) {
      const n = l - 1;
      expect(xpToNext(l)).toBe(Math.round(100 + 25 * n + 2.5 * n * n));
      expect(xpToNext(l + 1) > xpToNext(l) || l + 1 === MAX_LEVEL).toBe(true);
    }
  });

  it('needs nothing past the cap and rejects invalid levels', () => {
    expect(xpToNext(MAX_LEVEL)).toBe(0);
    expect(() => xpToNext(0)).toThrow();
    expect(() => xpToNext(1.5)).toThrow();
  });

  it('maps cumulative XP to levels at the exact thresholds', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(228);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(227)).toBe(2);
    expect(levelForXp(228)).toBe(3);
    const toMax = xpForLevel(MAX_LEVEL);
    expect(levelForXp(toMax - 1)).toBe(MAX_LEVEL - 1);
    expect(levelForXp(toMax)).toBe(MAX_LEVEL);
    expect(levelForXp(toMax * 10)).toBe(MAX_LEVEL);
  });

  it('reports progress inside a level and MAX at the cap', () => {
    expect(levelProgress(150)).toEqual({
      level: 2,
      into: 50,
      needed: 128,
      fraction: 50 / 128,
      max: false,
    });
    expect(levelProgress(xpForLevel(MAX_LEVEL) + 5000)).toMatchObject({
      level: MAX_LEVEL,
      fraction: 1,
      max: true,
    });
  });
});

describe('applyXp', () => {
  it('levels up once', () => {
    expect(applyXp({ level: 1, xp: 60 }, 40)).toEqual({ level: 2, xp: 100, levelsGained: 1 });
  });

  it('jumps several levels in one award', () => {
    const r = applyXp({ level: 1, xp: 0 }, xpForLevel(5) + 10);
    expect(r.level).toBe(5);
    expect(r.levelsGained).toBe(4);
  });

  it('caps at level 50 but keeps counting total XP', () => {
    const start = { level: 49, xp: xpForLevel(49) };
    const r = applyXp(start, 1_000_000);
    expect(r.level).toBe(MAX_LEVEL);
    expect(r.levelsGained).toBe(1);
    expect(r.xp).toBe(start.xp + 1_000_000);
    const again = applyXp(r, 500);
    expect(again.level).toBe(MAX_LEVEL);
    expect(again.levelsGained).toBe(0);
  });

  it('never goes negative or backwards', () => {
    expect(applyXp({ level: 3, xp: 300 }, -500)).toEqual({ level: 3, xp: 300, levelsGained: 0 });
    expect(applyXp({ level: 1, xp: 0 }, NaN)).toEqual({ level: 1, xp: 0, levelsGained: 0 });
    expect(applyXp({ level: 1, xp: 0 }, 10.6).xp).toBe(11);
  });
});

const aiInput = (over: Partial<AiAwardInput> = {}): AiAwardInput => ({
  difficulty: 'medium',
  outcome: 'win',
  reason: 'resignation',
  moves: 45,
  queenLost: true,
  priorStreak: 0,
  firstWinToday: false,
  assistsUsed: 0,
  ...over,
});

describe('vs AI awards', () => {
  it('uses the base table for every difficulty and outcome', () => {
    for (const [difficulty, row] of Object.entries(AI_XP)) {
      for (const outcome of ['win', 'draw', 'loss'] as const) {
        const a = aiAward(
          aiInput({ difficulty: difficulty as AiAwardInput['difficulty'], outcome }),
        );
        expect(a.total).toBe(row[outcome]);
      }
    }
  });

  it('adds every win bonus', () => {
    const a = aiAward(
      aiInput({
        reason: 'checkmate',
        moves: 30,
        queenLost: false,
        priorStreak: 2,
        firstWinToday: true,
      }),
    );
    // 110 + 11 (mate) + 11 (<40 moves) + 11 (queen) + 11 (streak 10%) + 50 (first win)
    expect(a.total).toBe(204);
    expect(a.lines).toHaveLength(6);
    expect(a.lines.reduce((s, l) => s + l.amount, 0)).toBe(a.total);
  });

  it('gives no win bonuses on draws and losses', () => {
    const bonuses = {
      reason: 'checkmate',
      moves: 20,
      queenLost: false,
      priorStreak: 5,
      firstWinToday: true,
    } as const;
    expect(aiAward(aiInput({ ...bonuses, outcome: 'loss' })).total).toBe(12);
    expect(aiAward(aiInput({ ...bonuses, reason: 'stalemate', outcome: 'draw' })).total).toBe(40);
  });

  it('caps the streak bonus at +25%', () => {
    const at = (priorStreak: number) =>
      aiAward(aiInput({ difficulty: 'grandmaster', priorStreak })).total;
    expect(at(0)).toBe(360);
    expect(at(1)).toBe(378); // +5%
    expect(at(4)).toBe(432); // +20%
    expect(at(5)).toBe(450); // +25%
    expect(at(6)).toBe(450);
    expect(at(50)).toBe(450);
  });

  it('takes 25% per hint/takeback, never below 25% of base', () => {
    const at = (assistsUsed: number) => aiAward(aiInput({ assistsUsed })).total;
    expect(at(1)).toBe(83); // 110 × 0.75 = 82.5
    expect(at(2)).toBe(55);
    expect(at(3)).toBe(28); // 27.5 ≥ floor 27.5
    expect(at(4)).toBe(28); // floor
    expect(at(20)).toBe(28);
    // Floor is 25% of base even when bonuses inflated the subtotal.
    const bonus = aiAward(aiInput({ assistsUsed: 10, firstWinToday: true, queenLost: false }));
    expect(bonus.total).toBe(28);
    // Losses are penalised too.
    expect(aiAward(aiInput({ outcome: 'loss', assistsUsed: 5 })).total).toBe(3);
  });

  it('gives 0 XP for games abandoned before move 5', () => {
    expect(isAbandoned('resignation', 4)).toBe(true);
    expect(isAbandoned('agreement', 1)).toBe(true);
    expect(isAbandoned('timeout', 3)).toBe(true);
    expect(isAbandoned('resignation', 5)).toBe(false);
    expect(isAbandoned('checkmate', 2)).toBe(false);
    const a = aiAward(aiInput({ outcome: 'loss', moves: 3 }));
    expect(a.total).toBe(0);
    expect(a.note).toMatch(/move 5/);
    expect(aiAward(aiInput({ outcome: 'win', moves: 4, reason: 'resignation' })).total).toBe(0);
  });
});

const pvpInput = (over: Partial<Parameters<typeof pvpAward>[0]> = {}) => ({
  outcome: 'win' as const,
  reason: 'checkmate' as const,
  moves: 25,
  sameProfile: false,
  gamesTodayBefore: 0,
  levelGap: 0 as number | null,
  ...over,
});

describe('vs Player awards', () => {
  it('gives 60 / 30 / 15', () => {
    expect(pvpAward(pvpInput()).total).toBe(60);
    expect(pvpAward(pvpInput({ outcome: 'draw' })).total).toBe(30);
    expect(pvpAward(pvpInput({ outcome: 'loss' })).total).toBe(15);
  });

  it('gives 0 XP for self-play', () => {
    const a = pvpAward(pvpInput({ sameProfile: true }));
    expect(a.total).toBe(0);
    expect(a.note).toMatch(/same profile/i);
  });

  it('needs the game to reach move 10', () => {
    expect(pvpAward(pvpInput({ moves: 9 })).total).toBe(0);
    expect(pvpAward(pvpInput({ moves: 10 })).total).toBe(60);
  });

  it('halves after 5 games a day with the same opponent and stops after 10', () => {
    const at = (gamesTodayBefore: number) => pvpAward(pvpInput({ gamesTodayBefore })).total;
    expect([0, 4].map(at)).toEqual([60, 60]);
    expect([5, 9].map(at)).toEqual([30, 30]);
    expect([10, 30].map(at)).toEqual([0, 0]);
    expect(pvpAward(pvpInput({ outcome: 'loss', gamesTodayBefore: 5 })).total).toBe(8);
  });

  it('scales the winner by level gap', () => {
    expect(pvpAward(pvpInput({ levelGap: 10 })).total).toBe(30);
    expect(pvpAward(pvpInput({ levelGap: 9 })).total).toBe(60);
    expect(pvpAward(pvpInput({ levelGap: -10 })).total).toBe(90);
    expect(pvpAward(pvpInput({ levelGap: null })).total).toBe(60);
    // Only the winner is affected.
    expect(pvpAward(pvpInput({ outcome: 'loss', levelGap: -15 })).total).toBe(15);
    // Combined with the daily halving.
    expect(pvpAward(pvpInput({ levelGap: -12, gamesTodayBefore: 6 })).total).toBe(45);
  });
});

// ---------- settlement ----------

const NOW = new Date(2026, 8, 30, 15, 0, 0);
const TODAY = localDay(NOW);

const profile = (name: string, over: Partial<Profile> = {}): Profile => ({
  ...newProfile(name, 'knight-indigo', NOW),
  ...over,
});

const moves = (n: number, captures: { at: number; piece: string }[] = []) =>
  Array.from({ length: n }, (_, i) => ({
    color: (i % 2 === 0 ? 'w' : 'b') as 'w' | 'b',
    captured: captures.find((c) => c.at === i)?.piece,
  }));

const aiSettings = (p: Profile, over: Partial<GameSettings> = {}): GameSettings => ({
  mode: 'pvai',
  timeControl: { id: 'untimed', initialMs: 0, incrementMs: 0 },
  players: { w: { name: p.name, profileId: p.id }, b: { name: 'Stockfish · Medium' } },
  autoFlip: false,
  difficulty: 'medium',
  humanColor: 'w',
  ...over,
});

const pvpSettings = (a: Profile | null, b: Profile | null): GameSettings => ({
  mode: 'pvp',
  timeControl: { id: 'untimed', initialMs: 0, incrementMs: 0 },
  players: {
    w: a ? { name: a.name, profileId: a.id } : { name: 'Guest' },
    b: b ? { name: b.name, profileId: b.id } : { name: 'Guest' },
  },
  autoFlip: false,
});

const game = (
  settings: GameSettings,
  result: GameResult,
  plies: number,
  extra: Partial<FinishedGame> = {},
): FinishedGame => ({
  settings,
  result,
  history: moves(plies),
  pgn: '1. e4 e5',
  assists: { hints: 0, undos: 0 },
  ...extra,
});

describe('settleMatch', () => {
  it('awards XP, updates stats and builds a history record for a vs-AI win', () => {
    const p = profile('Ana');
    const s = settleMatch([p], game(aiSettings(p), win('w', 'checkmate'), 41), NOW);
    const award = s.awards[0]!;
    // 110 + 11 mate + 11 short (21 moves) + 11 queen + 50 first win
    expect(award.award.total).toBe(193);
    expect(award.after).toEqual({ level: 2, xp: 193 });
    expect(award.levelsGained).toBe(1);
    const updated = s.profiles[0]!;
    expect(updated.stats).toMatchObject({
      played: 1,
      wins: 1,
      streak: 1,
      bestStreak: 1,
      lastWinDate: TODAY,
      fastestMate: 21,
    });
    expect(updated.stats.winsByDifficulty.medium).toBe(1);
    expect(s.record).toMatchObject({
      mode: 'pvai',
      white: p.id,
      black: 'ai:medium',
      result: '1-0',
      reason: 'checkmate',
      moves: 21,
      xpAwarded: { [p.id]: 193 },
    });
    expect(isGameRecord(s.record)).toBe(true);
  });

  it('gives the first-win bonus once a day and grows the streak', () => {
    const p = profile('Ana', {
      stats: { ...profile('x').stats, streak: 2, bestStreak: 2, lastWinDate: TODAY },
    });
    const s = settleMatch([p], game(aiSettings(p), win('w', 'resignation'), 100), NOW);
    // 110 + 11 queen + 11 streak (+10%), no first-win bonus
    expect(s.awards[0]!.award.total).toBe(132);
    expect(s.profiles[0]!.stats.streak).toBe(3);
    expect(s.profiles[0]!.stats.bestStreak).toBe(3);
  });

  it('notices a lost queen and resets the streak on a loss', () => {
    const p = profile('Ana', { stats: { ...profile('x').stats, streak: 4, bestStreak: 4 } });
    const lostQueen = settleMatch(
      [p],
      game(aiSettings(p), win('w', 'resignation'), 100, {
        history: moves(100, [{ at: 21, piece: 'q' }]),
      }),
      NOW,
    );
    expect(lostQueen.awards[0]!.award.lines.some((l) => /queen/i.test(l.label))).toBe(false);
    const lost = settleMatch([p], game(aiSettings(p), win('b', 'checkmate'), 60), NOW);
    expect(lost.awards[0]!.award.total).toBe(12);
    expect(lost.profiles[0]!.stats).toMatchObject({ losses: 1, streak: 0, bestStreak: 4 });
  });

  it('applies the hint/takeback penalty from the game', () => {
    const p = profile('Ana', { stats: { ...profile('x').stats, lastWinDate: TODAY } });
    const s = settleMatch(
      [p],
      game(aiSettings(p, { assists: true }), win('w', 'resignation'), 100, {
        assists: { hints: 3, undos: 2 },
      }),
      NOW,
    );
    expect(s.awards[0]!.award.total).toBe(28);
  });

  it('gives 0 XP (but records the game) when abandoned before move 5', () => {
    const p = profile('Ana');
    const s = settleMatch([p], game(aiSettings(p), win('b', 'resignation'), 6), NOW);
    expect(s.awards[0]!.award.total).toBe(0);
    expect(s.profiles[0]!.xp).toBe(0);
    expect(s.record.xpAwarded[p.id]).toBe(0);
  });

  it('gives 0 XP and no stats when one profile plays both sides', () => {
    const p = profile('Ana');
    const s = settleMatch([p], game(pvpSettings(p, p), win('w', 'checkmate'), 60), NOW);
    expect(s.awards).toHaveLength(1);
    expect(s.awards[0]!.award.total).toBe(0);
    expect(s.profiles[0]).toBe(p);
    expect(s.record.white).toBe(p.id);
    expect(s.record.black).toBe(p.id);
  });

  it('awards both local profiles and applies diminishing returns per pairing', () => {
    let a = profile('Ana');
    let b = profile('Ben');
    const totals: number[] = [];
    for (let i = 0; i < 12; i++) {
      const s = settleMatch([a, b], game(pvpSettings(a, b), win('w', 'checkmate'), 40), NOW);
      [a, b] = s.profiles as [Profile, Profile];
      totals.push(s.awards.find((x) => x.profileId === a.id)!.award.total);
    }
    expect(totals).toEqual([60, 60, 60, 60, 60, 30, 30, 30, 30, 30, 0, 0]);
    expect(a.pvpToday[b.id]).toEqual({ date: TODAY, count: 12 });
    expect(b.stats.losses).toBe(12);
    // A new day resets the counter.
    const tomorrow = new Date(NOW.getTime() + 24 * 3600_000);
    const s = settleMatch([a, b], game(pvpSettings(a, b), win('w', 'checkmate'), 40), tomorrow);
    expect(s.awards.find((x) => x.profileId === a.id)!.award.total).toBe(60);
    expect(Object.keys(s.profiles[0]!.pvpToday)).toEqual([b.id]);
  });

  it('does not count short local games towards the daily limit', () => {
    const a = profile('Ana');
    const s = settleMatch([a], game(pvpSettings(a, null), draw('agreement'), 12), NOW);
    expect(s.awards[0]!.award.total).toBe(0);
    expect(s.profiles[0]!.pvpToday).toEqual({});
    expect(s.profiles[0]!.stats.draws).toBe(1);
    expect(s.record.black).toBe('guest');
  });

  it('applies the level-gap multiplier with levels from before the game', () => {
    const low = profile('Low', { level: 2, xp: xpForLevel(2) });
    const high = profile('High', { level: 14, xp: xpForLevel(14) });
    const s = settleMatch(
      [low, high],
      game(pvpSettings(low, high), win('w', 'checkmate'), 40),
      NOW,
    );
    expect(s.awards.find((x) => x.profileId === low.id)!.award.total).toBe(90);
    expect(s.awards.find((x) => x.profileId === high.id)!.award.total).toBe(15);
  });

  it('skips profiles that no longer exist', () => {
    const p = profile('Ana');
    const s = settleMatch([], game(aiSettings(p), win('w', 'checkmate'), 41), NOW);
    expect(s.awards).toEqual([]);
    expect(s.record.white).toBe('guest');
  });
});

describe('profile validation', () => {
  it('round-trips a real profile', () => {
    const p = profile('Ana', { pvpToday: { guest: { date: TODAY, count: 2 } } });
    expect(sanitizeProfile(p)).toEqual(p);
  });

  it('repairs bad fields and drops unusable profiles', () => {
    const p = sanitizeProfile({
      id: 'abc',
      name: '  Ana ',
      level: 99,
      xp: -5,
      stats: { wins: 'lots', winsByDifficulty: { easy: 3 } },
      pvpToday: { '../x': { date: TODAY, count: 1 } },
    })!;
    expect(p).toMatchObject({ name: 'Ana', level: 1, xp: 0, pvpToday: {} });
    expect(p.stats.wins).toBe(0);
    expect(p.stats.winsByDifficulty).toMatchObject({ easy: 3, grandmaster: 0 });
    expect(sanitizeProfile({ id: 'guest', name: 'x' })).toBeNull();
    expect(sanitizeProfile({ id: 'Bad Id', name: 'x' })).toBeNull();
    expect(sanitizeProfile({ id: 'ok', name: '   ' })).toBeNull();
  });

  it('dedupes profiles and fixes the active id', () => {
    const a = profile('Ana');
    const doc = sanitizeProfilesDoc({ activeId: 'missing', profiles: [a, a, 'junk'] });
    expect(doc.profiles).toHaveLength(1);
    expect(doc.activeId).toBe(a.id);
    expect(sanitizeProfilesDoc(null)).toEqual({ activeId: null, profiles: [] });
  });
});
