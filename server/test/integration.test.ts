import { afterEach, describe, expect, it } from 'vitest';
import { WS_PATH, QUICK_MATCH_POOLS } from '@shared/protocol';
import { Bot, hello, pairByCode, player, startServer } from './helpers';
import type { GameServer } from '../src/server';

let running: GameServer | null = null;
const bots: Bot[] = [];

async function setup(overrides = {}) {
  // Teardown shuts the server down; don't wait for games left running by a test.
  const s = await startServer({ shutdownGraceMs: 50, ...overrides });
  running = s.server;
  return s;
}

afterEach(async () => {
  for (const b of bots.splice(0)) b.close();
  await running?.shutdown();
  running = null;
});

const track = <T extends Bot>(b: T) => (bots.push(b), b);

async function playMoves(white: Bot, black: Bot, gameId: string, moves: string[]) {
  for (let i = 0; i < moves.length; i++) {
    const mover = i % 2 === 0 ? white : black;
    mover.send({ t: 'game.move', gameId, uci: moves[i]!, seq: i });
    await white.next('game.state', (s) => s.seq === i + 1);
    await black.next('game.state', (s) => s.seq === i + 1);
  }
}

describe('integration over WebSockets', () => {
  it('health endpoint', async () => {
    const { http } = await setup();
    const res = await fetch(`${http}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', protocol: 1, liveGames: 0 });
    expect((await fetch(`${http}/nope`)).status).toBe(404);
  });

  it('invite code game with castling, en passant and promotion, ending in resignation', async () => {
    const { url } = await setup();
    const { white, black, gameId } = await pairByCode(url, player(1), player(2));
    track(white);
    track(black);
    await playMoves(white, black, gameId, [
      'e2e4',
      'g8f6',
      'e4e5',
      'd7d5',
      'e5d6',
      'e7e6',
      'g1f3',
      'b8c6',
      'f1e2',
      'c8d7',
      'e1g1',
      'a7a6',
      'd6c7',
      'a6a5',
      'c7d8q',
    ]);
    black.send({ t: 'game.resign', gameId });
    const over = await white.next('game.over');
    expect(over).toMatchObject({ result: '1-0', winner: 'w', reason: 'resignation', plies: 15 });
    expect(over.pgn).toContain('O-O');
    expect(over.pgn).toContain('exd6');
    expect(over.pgn).toContain('cxd8=Q+');
    expect(white.invalid).toEqual([]);
    expect(black.invalid).toEqual([]);
  });

  it('checkmate, then a rematch with colours swapped', async () => {
    const { url } = await setup();
    const { white, black, gameId } = await pairByCode(url, player(1), player(2));
    track(white);
    track(black);
    await playMoves(white, black, gameId, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    expect(await black.next('game.over')).toMatchObject({ result: '1-0', reason: 'checkmate' });
    black.send({ t: 'game.rematch', gameId });
    await white.next('game.rematchOffer');
    white.send({ t: 'game.rematchAccept', gameId });
    const next = await white.next('game.start');
    expect(next.color).toBe('b');
    expect(next.gameId).not.toBe(gameId);
  });

  it('quick match pairs two players', async () => {
    const { url } = await setup();
    const a = track(await Bot.join(url, player(1)));
    const b = track(await Bot.join(url, player(2)));
    a.send({ t: 'queue.join', tc: QUICK_MATCH_POOLS[0]! });
    await a.next('queue.waiting');
    b.send({ t: 'queue.join', tc: QUICK_MATCH_POOLS[0]! });
    const [sa, sb] = await Promise.all([a.next('game.start'), b.next('game.start')]);
    expect(sa.gameId).toBe(sb.gameId);
    expect(new Set([sa.color, sb.color])).toEqual(new Set(['w', 'b']));
  });

  it('a dropped connection rejoins with its token; the opponent sees it go and come back', async () => {
    const { url } = await setup();
    const { white, black, gameId, tokens } = await pairByCode(url, player(1), player(2));
    track(white);
    await playMoves(white, black, gameId, ['e2e4', 'e7e5']);
    black.close();
    const away = await white.next('game.opponentStatus', (m) => !m.connected);
    expect(away.graceEndsAt).toBeGreaterThan(Date.now() + 50_000);

    const back = track(await Bot.join(url, player(2)));
    back.send({ t: 'game.rejoin', gameId, token: 'not-the-token' });
    expect(await back.next('error')).toMatchObject({ code: 'NOT_FOUND' });
    back.send({ t: 'game.rejoin', gameId, token: tokens.b });
    expect(await back.next('game.start')).toMatchObject({ gameId, color: 'b', token: tokens.b });
    expect(await back.next('game.state')).toMatchObject({ seq: 2, moves: ['e2e4', 'e7e5'] });
    await white.next('game.opponentStatus', (m) => m.connected);
    await playMoves(white, back, gameId, []);
    white.send({ t: 'game.move', gameId, uci: 'g1f3', seq: 2 });
    await back.next('game.state', (s) => s.seq === 3);
    back.send({ t: 'game.move', gameId, uci: 'b8c6', seq: 3 });
    expect(await white.next('game.state', (s) => s.seq === 4)).toMatchObject({ turn: 'w' });
  });

  it('cheating and broken clients are refused without disturbing the game', async () => {
    const { url } = await setup({ maxStrikes: 3 });
    const { white, black, gameId } = await pairByCode(url, player(1), player(2));
    track(white);
    track(black);
    // Out of turn, illegal, replayed, wrong game.
    black.send({ t: 'game.move', gameId, uci: 'e7e5', seq: 0 });
    expect(await black.next('error')).toMatchObject({ code: 'NOT_YOUR_TURN' });
    white.send({ t: 'game.move', gameId, uci: 'e2e5', seq: 0 });
    expect(await white.next('error')).toMatchObject({ code: 'ILLEGAL' });
    await playMoves(white, black, gameId, ['e2e4']);
    white.send({ t: 'game.move', gameId, uci: 'd2d4', seq: 0 });
    expect(await white.next('error')).toMatchObject({ code: 'ILLEGAL' });
    black.send({ t: 'game.move', gameId: 'someone-elses', uci: 'e7e5', seq: 1 });
    expect(await black.next('error')).toMatchObject({ code: 'NOT_FOUND' });
    // The game is untouched.
    await playMoves(white, black, gameId, []);
    black.send({ t: 'game.move', gameId, uci: 'e7e5', seq: 1 });
    expect(await white.next('game.state', (s) => s.seq === 2)).toMatchObject({
      moves: ['e2e4', 'e7e5'],
    });

    // Garbage gets a BAD_MSG; repeated garbage gets the connection closed.
    const junk = track(await Bot.join(url, player(3)));
    for (let i = 0; i < 4; i++) junk.send('{not json');
    expect(await junk.next('error')).toMatchObject({ code: 'BAD_MSG' });
    expect(await junk.closed()).toBe(1008);

    // Oversized frames close the connection (ws enforces maxPayload).
    const big = track(await Bot.join(url, player(4)));
    big.send(JSON.stringify({ t: 'ping', ts: 1, pad: 'x'.repeat(10_000) }));
    expect(await big.closed()).toBe(1009);
  });

  it('flooding is rate-limited', async () => {
    const { url } = await setup({ rateBurst: 5, ratePerSecond: 1, maxStrikes: 100 });
    const spam = track(await Bot.join(url, player(5)));
    for (let i = 0; i < 20; i++) spam.send({ t: 'ping', ts: i });
    expect(await spam.next('error')).toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('old apps are told to update', async () => {
    const { url } = await setup({ minAppVersion: '1.0.0' });
    const old = track(await Bot.open(url));
    old.send(hello(player(6), '0.9.0'));
    expect(await old.next('error')).toMatchObject({ code: 'UPGRADE_REQUIRED' });
    expect(await old.closed()).toBe(4000);
  });

  it('limits connections per IP and only serves the WebSocket path', async () => {
    const { url } = await setup({ maxConnectionsPerIp: 2 });
    track(await Bot.open(url));
    track(await Bot.open(url));
    await expect(Bot.open(url)).rejects.toThrow(/429/);
    await expect(Bot.open(url.replace(WS_PATH, '/other'))).rejects.toThrow(/404/);
  });

  it('times out on the server clock', async () => {
    const { url } = await setup({ minBaseMs: 1_000 });
    const tc = { baseMs: 1_000, incMs: 0 };
    const { white, black, gameId } = await pairByCode(url, player(1), player(2), tc);
    track(white);
    track(black);
    await playMoves(white, black, gameId, ['e2e4', 'e7e5']);
    const over = await black.next('game.over', () => true, 4_000);
    expect(over).toMatchObject({ result: '0-1', reason: 'timeout' });
  });

  it('shutdown ends live games without a result', async () => {
    const { url, server } = await setup({ shutdownGraceMs: 200 });
    const { white, black } = await pairByCode(url, player(1), player(2));
    track(white);
    track(black);
    running = null;
    await server.shutdown();
    expect(await white.next('game.over')).toMatchObject({ result: '*', reason: 'server-shutdown' });
  });
});
