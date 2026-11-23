import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg } from '@shared/protocol';
import type { GameSettings, Profile } from '@shared/types';
import {
  cleanDisplayName,
  isGameRecord,
  isOnlineRejoin,
  sanitizeOnlineIdentity,
  sanitizeProfile,
} from '@shared/validate';
import { draw, win, type GameResult } from '@/game/rules';
import { Connection, SILENCE_MS, type ConnStatus, type SocketLike } from '@/net/connection';
import { ClockSync, reconnectDelay, BACKOFF } from '@/net/timing';
import { onlineAward } from '@/progression/awards';
import {
  localDay,
  newProfile,
  settleOnlineMatch,
  type FinishedOnlineGame,
} from '@/progression/match';
import { setGamePersistence, setOnlineMoveSink, useGameStore } from '@/store/gameStore';

// ---------------------------------------------------------------------------
// Timing

describe('reconnect backoff', () => {
  it('grows exponentially, is capped, and is jittered between half and all of the step', () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(10, () => 1)).toBe(BACKOFF.maxMs);
    expect(reconnectDelay(10, () => 0)).toBe(BACKOFF.maxMs / 2);
  });
});

describe('clock sync', () => {
  it('estimates the server clock offset from the fastest round trip', () => {
    const c = new ClockSync();
    expect(c.offset).toBe(0);
    // Server is 5 s ahead. A slow, asymmetric round trip gives a worse estimate…
    c.add(1000, 6000 + 400, 1500);
    // …than a fast one, which wins.
    c.add(2000, 7000 + 10, 2020);
    expect(c.rtt).toBe(20);
    expect(c.offset).toBe(5000);
    expect(c.toLocal(10_000)).toBe(5000);
  });

  it('ignores impossible samples and forgets old ones', () => {
    const c = new ClockSync(2);
    c.add(100, 0, 50);
    expect(c.ready).toBe(false);
    c.add(0, 100, 2); // rtt 2, offset 99
    c.add(0, 300, 10);
    c.add(0, 400, 10);
    expect(c.rtt).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Connection

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMsg[] = [];
  closed: number | null = null;
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  onmessage: SocketLike['onmessage'] = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closed = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function fakeEnv() {
  let now = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const sockets: FakeSocket[] = [];
  const statuses: ConnStatus[] = [];
  const messages: string[] = [];
  const conn = new Connection(
    'ws://test/ws',
    () => ({
      appVersion: '0.9.0',
      player: { guestId: 'guest-1234-5678', name: 'Ana', level: 3, avatarId: 'knight-indigo' },
    }),
    { status: (s) => statuses.push(s), message: (m) => messages.push(m.t) },
    {
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      now: () => now,
      setTimeout: (fn, ms) => {
        timers.set(++id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (h) => void timers.delete(h as number),
      random: () => 1,
    },
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const socket = () => sockets[sockets.length - 1]!;
  const welcome = () =>
    socket().receive({ t: 'welcome', protocol: 1, serverTs: now, minAppVersion: '0.9.0' });
  return { conn, sockets, socket, statuses, messages, advance, welcome, now: () => now };
}

describe('connection', () => {
  it('says hello on open, goes online on welcome and pings for the clock offset', () => {
    const env = fakeEnv();
    env.conn.start();
    expect(env.statuses).toEqual(['connecting']);
    env.socket().open();
    expect(env.socket().sent[0]).toMatchObject({ t: 'hello', v: 1, appVersion: '0.9.0' });
    env.welcome();
    expect(env.conn.state).toBe('online');
    expect(env.messages).toEqual(['welcome']);
    const ping = env.socket().sent.find((m) => m.t === 'ping') as { ts: number };
    expect(ping).toBeDefined();
    env.advance(20);
    env.socket().receive({ t: 'pong', ts: ping.ts, serverTs: ping.ts + 3000 });
    expect(env.conn.clock.offset).toBe(2990);
    // Pongs are not passed on.
    expect(env.messages).toEqual(['welcome']);
  });

  it('reconnects with backoff after a drop and says hello again', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().open();
    env.welcome();
    env.socket().drop();
    expect(env.conn.state).toBe('reconnecting');
    expect(env.sockets).toHaveLength(1);
    env.advance(1000);
    expect(env.sockets).toHaveLength(2);
    env.socket().open();
    expect(env.socket().sent[0]).toMatchObject({ t: 'hello' });
    env.welcome();
    expect(env.conn.state).toBe('online');
  });

  it('reports offline after repeated failures but keeps trying', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().drop();
    expect(env.conn.state).toBe('offline');
    env.advance(1000);
    env.socket().drop();
    env.advance(2000);
    expect(env.sockets).toHaveLength(3);
    env.conn.retryNow();
    expect(env.sockets).toHaveLength(3); // an attempt is already in flight
  });

  it('treats a silent link as dead', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().open();
    env.welcome();
    const first = env.socket();
    // Pongs keep the link alive.
    for (let i = 0; i < 5; i++) {
      env.advance(SILENCE_MS / 2);
      const ping = [...first.sent].reverse().find((m) => m.t === 'ping') as { ts: number };
      first.receive({ t: 'pong', ts: ping.ts, serverTs: ping.ts });
    }
    expect(env.sockets).toHaveLength(1);
    env.advance(SILENCE_MS + 1);
    expect(first.closed).not.toBeNull();
    expect(env.conn.state).toBe('reconnecting');
  });

  it('stops for good when the app is too old or replaced', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().open();
    env.socket().receive({ t: 'error', code: 'UPGRADE_REQUIRED', message: 'Please update.' });
    env.socket().drop(4000);
    expect(env.conn.state).toBe('upgrade');
    env.advance(60_000);
    expect(env.sockets).toHaveLength(1);
    env.conn.start();
    expect(env.sockets).toHaveLength(1);
  });

  it('retries slowly while the server is busy', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().open();
    env.socket().receive({ t: 'error', code: 'BUSY', message: 'Maintenance until 10:00' });
    env.socket().drop(4001);
    expect(env.conn.state).toBe('busy');
    env.advance(20_000);
    expect(env.sockets).toHaveLength(1);
    env.advance(10_000);
    expect(env.sockets).toHaveLength(2);
  });

  it('drops invalid server messages and refuses to send before the welcome or oversize', () => {
    const env = fakeEnv();
    env.conn.start();
    env.socket().open();
    expect(env.conn.send({ t: 'queue.leave' })).toBe(false);
    env.welcome();
    env.socket().onmessage?.({ data: '{"t":"game.state","gameId":"x"}' });
    env.socket().onmessage?.({ data: 'not json' });
    expect(env.messages).toEqual(['welcome']);
    expect(env.conn.send({ t: 'room.join', code: 'X'.repeat(5000) })).toBe(false);
    expect(env.conn.send({ t: 'queue.leave' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The board in online mode

const store = () => useGameStore.getState();
const GAME = 'game-abc';

const onlineSettings = (color: 'w' | 'b'): GameSettings => ({
  mode: 'online',
  timeControl: { id: 'online-180000+2000', initialMs: 180_000, incrementMs: 2_000 },
  players: {
    w: color === 'w' ? { name: 'Me', profileId: 'me' } : { name: 'Opp', level: 7, avatarId: 'x' },
    b: color === 'b' ? { name: 'Me', profileId: 'me' } : { name: 'Opp', level: 7, avatarId: 'x' },
  },
  autoFlip: false,
  online: { gameId: GAME, color, opponentId: 'opp-1' },
});

const snap = (moves: string[], clocks = { w: 180_000, b: 180_000 }, anchor = Date.now()) => ({
  moves,
  clocks,
  clockRunning: moves.length >= 1,
  anchor,
});

describe('game store online mode', () => {
  let sent: { gameId: string; uci: string; seq: number }[] = [];
  let cleared = 0;

  beforeEach(() => {
    sent = [];
    cleared = 0;
    setGamePersistence({ save: () => {}, clear: () => cleared++ });
    setOnlineMoveSink((gameId, uci, seq) => sent.push({ gameId, uci, seq }));
    store().reset();
  });

  it('shows our move at once, sends it, and keeps it until the server confirms', () => {
    expect(store().startOnline(onlineSettings('w'), snap([]))).toBe(true);
    expect(store().orientation).toBe('w');
    expect(store().attemptMove('e2', 'e4')).toBe('moved');
    expect(sent).toEqual([{ gameId: GAME, uci: 'e2e4', seq: 0 }]);
    expect(store().history).toHaveLength(1);
    // No second move while the first is unconfirmed (it is not our turn anyway).
    expect(store().attemptMove('d2', 'd4')).toBe('illegal');

    // A state from before our move (e.g. a draw offer) does not take it back.
    store().syncOnline(GAME, snap([]));
    expect(store().history.map((m) => m.lan)).toEqual(['e2e4']);
    expect(store().online?.pending).not.toBeNull();

    // Confirmed, then the opponent replies.
    store().syncOnline(GAME, snap(['e2e4']));
    expect(store().online?.pending).toBeNull();
    store().syncOnline(GAME, snap(['e2e4', 'e7e5']));
    expect(store().history.map((m) => m.lan)).toEqual(['e2e4', 'e7e5']);
    expect(store().attemptMove('g1', 'f3')).toBe('moved');
    expect(sent.at(-1)).toEqual({ gameId: GAME, uci: 'g1f3', seq: 2 });
  });

  it("refuses input on the opponent's turn", () => {
    store().startOnline(onlineSettings('b'), snap([]));
    expect(store().orientation).toBe('b');
    expect(store().attemptMove('e2', 'e4')).toBe('illegal');
    store().selectSquare('e2');
    expect(store().selected).toBeNull();
    store().syncOnline(GAME, snap(['e2e4']));
    expect(store().attemptMove('e7', 'e5')).toBe('moved');
  });

  it('rolls back a refused move and adopts whatever the server says', () => {
    store().startOnline(onlineSettings('w'), snap([]));
    store().attemptMove('e2', 'e4');
    store().syncOnline(GAME, snap([]), { discardPending: true });
    expect(store().history).toHaveLength(0);
    expect(store().online?.pending).toBeNull();
    // A completely different line from the server replaces ours.
    store().attemptMove('d2', 'd4');
    store().syncOnline(GAME, snap(['e2e4', 'c7c5']));
    expect(store().history.map((m) => m.lan)).toEqual(['e2e4', 'c7c5']);
    expect(store().syncOnline(GAME, snap(['e2e5']))).toBe(false);
  });

  it('runs clocks for display only, from the server reading', () => {
    const t0 = Date.now();
    store().startOnline(onlineSettings('w'), snap(['e2e4'], { w: 170_000, b: 175_000 }, t0));
    store().tick(t0 + 4_000);
    expect(store().clocks).toEqual({ w: 170_000, b: 171_000 });
    // Never flags locally: only the server decides a timeout.
    store().tick(t0 + 999_000);
    expect(store().clocks.b).toBe(0);
    expect(store().status).toBe('playing');
  });

  it('credits the increment to our optimistic clock and starts the other one', () => {
    const t0 = Date.now();
    store().startOnline(onlineSettings('b'), snap(['e2e4'], { w: 180_000, b: 180_000 }, t0));
    store().tick(t0 + 5_000);
    store().attemptMove('e7', 'e5', { now: t0 + 5_000 });
    expect(store().clocks.b).toBe(177_000);
    store().tick(t0 + 6_000);
    expect(store().clocks.w).toBe(179_000);
  });

  it('ends only when the server says so, without touching a saved local game', () => {
    store().startOnline(onlineSettings('w'), snap(['f2f3', 'e7e5', 'g2g4']));
    store().syncOnline(GAME, snap(['f2f3', 'e7e5', 'g2g4', 'd8h4']));
    expect(store().status).toBe('playing');
    store().finishOnline('other-game', win('b', 'checkmate'));
    expect(store().status).toBe('playing');
    store().finishOnline(GAME, win('b', 'checkmate'));
    expect(store().status).toBe('over');
    expect(store().result?.reason).toBe('checkmate');
    expect(cleared).toBe(0);
    expect(store().toSavedGame()).toBeNull();
  });

  it('cannot be paused, undone, resigned or drawn locally', () => {
    store().startOnline(onlineSettings('w'), snap([]));
    store().setPaused(true);
    expect(store().paused).toBe(false);
    store().resign('w');
    store().agreeDraw();
    expect(store().status).toBe('playing');
    expect(store().undo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// XP and settlement

const NOW = new Date('2026-11-23T12:00:00');
const TODAY = localDay(NOW);

describe('online XP', () => {
  const base = {
    outcome: 'win' as const,
    reason: 'resignation' as const,
    moves: 30,
    priorStreak: 0,
    firstWinToday: false,
    gamesTodayBefore: 0,
  };

  it('pays 80 / 35 / 12 with win bonuses', () => {
    expect(onlineAward({ ...base, moves: 45 }).total).toBe(80);
    expect(onlineAward({ ...base, outcome: 'draw', reason: 'agreement' }).total).toBe(35);
    expect(onlineAward({ ...base, outcome: 'loss' }).total).toBe(12);
    // Checkmate +10%, under 40 moves +10%, streak of 2 before → +10%, first online win +50.
    const full = onlineAward({
      ...base,
      reason: 'checkmate',
      priorStreak: 2,
      firstWinToday: true,
    });
    expect(full.total).toBe(80 + 8 + 8 + 8 + 50);
    expect(onlineAward({ ...base, moves: 45, priorStreak: 9 }).total).toBe(80 + 20);
  });

  it('needs move 10 and tapers off against the same opponent', () => {
    expect(onlineAward({ ...base, moves: 9 }).total).toBe(0);
    expect(onlineAward({ ...base, moves: 45, gamesTodayBefore: 2 }).total).toBe(80);
    expect(onlineAward({ ...base, moves: 45, gamesTodayBefore: 3 }).total).toBe(40);
    expect(onlineAward({ ...base, moves: 45, gamesTodayBefore: 6 }).total).toBe(0);
  });
});

describe('settleOnlineMatch', () => {
  let me: Profile;
  beforeEach(() => {
    me = newProfile('Ana', 'knight-indigo', NOW);
  });

  const finished = (result: GameResult, plies: number, extra: Partial<FinishedOnlineGame> = {}) =>
    ({
      gameId: 'srv-game-1',
      profileId: me.id,
      color: 'w',
      players: { w: { name: 'Ana' }, b: { name: 'Zed' } },
      opponentId: 'opp_42',
      result,
      plies,
      pgn: '1. e4 e5 *',
      ...extra,
    }) satisfies FinishedOnlineGame;

  it('awards XP from the server result and records the game', () => {
    const s = settleOnlineMatch([me], finished(win('w', 'resignation'), 20), NOW)!;
    const p = s.profiles[0]!;
    expect(s.awards[0]!.award.total).toBe(80 + 8 + 50);
    expect(p.xp).toBe(138);
    expect(p.stats.online).toEqual({ played: 1, wins: 1, draws: 0, losses: 0, lastWinDate: TODAY });
    expect(p.stats).toMatchObject({ played: 1, wins: 1, streak: 1 });
    expect(p.onlineToday['opp_42']).toEqual({ date: TODAY, count: 1 });
    expect(p.achievements['first-win']).toBeDefined();
    expect(s.record).toMatchObject({
      mode: 'online',
      white: me.id,
      black: 'online:opp_42',
      whiteName: 'Ana',
      blackName: 'Zed',
      result: '1-0',
      moves: 10,
      onlineGameId: 'srv-game-1',
      xpAwarded: { [me.id]: 138 },
    });
    expect(isGameRecord(s.record)).toBe(true);
  });

  it('shares the win streak with vs-AI games and halves XP after 3 games with one opponent', () => {
    me.stats.streak = 4;
    me.stats.online.lastWinDate = TODAY;
    me.onlineToday = { opp_42: { date: TODAY, count: 3 }, old: { date: '2020-01-01', count: 9 } };
    const s = settleOnlineMatch([me], finished(win('b', 'checkmate'), 90, { color: 'b' }), NOW)!;
    // Streak 4 → +20%, checkmate +10%: 80 + 8 + 16 = 104, halved = 52.
    expect(s.awards[0]!.award.total).toBe(52);
    expect(s.profiles[0]!.stats.streak).toBe(5);
    expect(s.profiles[0]!.onlineToday).toEqual({ opp_42: { date: TODAY, count: 4 } });
    expect(s.record.black).toBe(me.id);
  });

  it('records losses and draws, and short games without XP', () => {
    const loss = settleOnlineMatch([me], finished(win('b', 'timeout'), 30), NOW)!;
    expect(loss.awards[0]!.award.total).toBe(12);
    expect(loss.profiles[0]!.stats.online.losses).toBe(1);
    expect(loss.profiles[0]!.stats.streak).toBe(0);
    const short = settleOnlineMatch([me], finished(draw('agreement'), 8), NOW)!;
    expect(short.awards[0]!.award.total).toBe(0);
    expect(short.profiles[0]!.stats.online.draws).toBe(1);
    expect(short.profiles[0]!.onlineToday).toEqual({});
  });

  it('does not count an early abandonment, and records nothing for aborted games', () => {
    const early = settleOnlineMatch([me], finished(win('w', 'abandonment'), 6), NOW)!;
    expect(early.awards).toEqual([]);
    expect(early.profiles[0]).toBe(me);
    expect(early.record.reason).toBe('abandonment');
    const late = settleOnlineMatch([me], finished(win('w', 'abandonment'), 24), NOW)!;
    expect(late.profiles[0]!.stats.online.wins).toBe(1);
    expect(
      settleOnlineMatch([me], finished({ result: '*', winner: null, reason: 'aborted' }, 1), NOW),
    ).toBeNull();
  });

  it('records the game for a player without a profile', () => {
    const s = settleOnlineMatch(
      [],
      finished(win('w', 'resignation'), 30, { profileId: null }),
      NOW,
    )!;
    expect(s.awards).toEqual([]);
    expect(s.record.white).toBe('guest');
    expect(isGameRecord(s.record)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stored data

describe('online data validation', () => {
  it('fills in online stats for profiles saved by older versions', () => {
    const p = sanitizeProfile({ id: 'abc', name: 'Old', stats: { played: 3 } })!;
    expect(p.stats.online).toEqual({ played: 0, wins: 0, draws: 0, losses: 0 });
    expect(p.onlineToday).toEqual({});
  });

  it('validates identities, rejoin info and display names', () => {
    expect(sanitizeOnlineIdentity({ guestId: 'short' })).toBeNull();
    expect(
      sanitizeOnlineIdentity({ guestId: '0f8fad5b-d9cb-469f-a165-70867728950e', displayName: 3 }),
    ).toEqual({ guestId: '0f8fad5b-d9cb-469f-a165-70867728950e', displayName: '' });
    expect(isOnlineRejoin({ gameId: 'g1', token: 't_1', savedAt: NOW.toISOString() })).toBe(true);
    expect(isOnlineRejoin({ gameId: 'g 1', token: 't', savedAt: NOW.toISOString() })).toBe(false);
    expect(cleanDisplayName('  Ana\u0007 the Great Grandmaster  ')).toBe('Ana the Great Grandm');
  });
});
