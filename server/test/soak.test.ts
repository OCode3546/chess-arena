import { Chess } from 'chess.js';
import { afterAll, describe, expect, it } from 'vitest';
import { QUICK_MATCH_POOLS, type ServerMsg, type Side } from '@shared/protocol';
import { Bot, player, startServer } from './helpers';
import type { GameServer } from '../src/server';

const GAMES = 100;
const MAX_PLIES = 120;

let server: GameServer | null = null;
afterAll(async () => server?.shutdown());

/** Play random legal moves for `color` until the game ends (White resigns at MAX_PLIES). */
async function playOut(bot: Bot, gameId: string, color: Side) {
  let lastSeq = -1;
  for (;;) {
    const msg = await bot.nextMatch(
      (m) =>
        (m.t === 'game.over' && m.gameId === gameId) ||
        (m.t === 'game.state' && m.gameId === gameId && m.turn === color && m.seq > lastSeq) ||
        m.t === 'error',
      30_000,
    );
    if (msg.t === 'error') throw new Error(`Server refused a legal move: ${msg.message}`);
    if (msg.t === 'game.over') return msg;
    if (msg.t !== 'game.state') continue;
    lastSeq = msg.seq;
    if (msg.seq >= MAX_PLIES) {
      if (color === 'w') bot.send({ t: 'game.resign', gameId });
      continue;
    }
    const legal = new Chess(msg.fen).moves({ verbose: true });
    // Mate or stalemate: the final state arrives just before game.over.
    if (legal.length === 0) continue;
    const m = legal[Math.floor(Math.random() * legal.length)]!;
    bot.send({ t: 'game.move', gameId, uci: `${m.from}${m.to}${m.promotion ?? ''}`, seq: msg.seq });
  }
}

describe('soak', () => {
  it(`${GAMES} concurrent quick-match games of random moves finish with correct results`, async () => {
    const s = await startServer({ maxConnectionsPerIp: 1_000, shutdownGraceMs: 50 });
    server = s.server;
    // Connect in batches: macOS's listen backlog (128) resets a burst of 200 at once.
    const bots: Bot[] = [];
    for (let i = 0; i < GAMES * 2; i += 25) {
      const batch = Array.from({ length: 25 }, (_, j) => Bot.join(s.url, player(1000 + i + j)));
      bots.push(...(await Promise.all(batch)));
    }
    for (const b of bots) b.send({ t: 'queue.join', tc: QUICK_MATCH_POOLS[0]! });
    const starts = await Promise.all(bots.map((b) => b.next('game.start', () => true, 15_000)));
    expect(new Set(starts.map((x) => x.gameId)).size).toBe(GAMES);
    expect(s.server.hub.stats().liveGames).toBe(GAMES);

    const results = await Promise.all(
      bots.map((b, i) => playOut(b, starts[i]!.gameId, starts[i]!.color)),
    );

    const byGame = new Map<string, Extract<ServerMsg, { t: 'game.over' }>[]>();
    for (const r of results) {
      if (r.t !== 'game.over') continue;
      byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
    }
    expect(byGame.size).toBe(GAMES);
    const reasons: Record<string, number> = {};
    for (const [, [a, b]] of byGame) {
      // Both players were told the same result.
      expect(a).toEqual(b);
      reasons[a!.reason] = (reasons[a!.reason] ?? 0) + 1;
      // The PGN replays as a legal game of the reported length and ending.
      const replay = new Chess();
      replay.loadPgn(a!.pgn);
      expect(replay.history().length).toBe(a!.plies);
      if (a!.reason === 'checkmate') expect(replay.isCheckmate()).toBe(true);
      if (a!.reason === 'stalemate') expect(replay.isStalemate()).toBe(true);
      if (a!.reason === 'resignation') expect(a!.plies).toBeGreaterThanOrEqual(MAX_PLIES);
      expect([
        'checkmate',
        'stalemate',
        'threefold',
        'fifty-move',
        'insufficient',
        'resignation',
      ]).toContain(a!.reason);
    }
    for (const b of bots) expect(b.invalid).toEqual([]);
    expect(s.server.hub.stats().liveGames).toBe(0);
    console.log('soak results by reason:', reasons);
    for (const b of bots) b.close();
  }, 120_000);
});
