import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, QUICK_MATCH_POOLS } from '@shared/protocol';
import { FakeConn, hello, makeHub, player, TC } from './helpers';

const BLITZ = QUICK_MATCH_POOLS[1]!;

describe('Hub: hello', () => {
  it('welcomes current apps and turns away old ones', () => {
    const { hub, join } = makeHub();
    const ok = join(player(1));
    expect(ok.last('welcome')).toMatchObject({
      protocol: PROTOCOL_VERSION,
      minAppVersion: '0.9.0',
    });

    const old = new FakeConn();
    hub.connect(old);
    hub.handle(old, hello(player(2), '0.8.0'));
    expect(old.last('error')).toMatchObject({ code: 'UPGRADE_REQUIRED' });
    expect(old.closed?.code).toBe(4000);

    const wrongProtocol = new FakeConn();
    hub.connect(wrongProtocol);
    hub.handle(wrongProtocol, { ...hello(player(3)), v: PROTOCOL_VERSION + 1 } as never);
    expect(wrongProtocol.last('error')).toMatchObject({ code: 'UPGRADE_REQUIRED' });
  });

  it('requires hello before anything else', () => {
    const { hub } = makeHub();
    const conn = new FakeConn();
    hub.connect(conn);
    hub.handle(conn, { t: 'queue.join', tc: BLITZ });
    expect(conn.last('error')).toMatchObject({ code: 'BAD_MSG' });
  });

  it('turns everyone away during maintenance', () => {
    const { join } = makeHub({ maintenanceMessage: 'Back at 18:00' });
    const conn = join(player(1));
    expect(conn.last('error')).toMatchObject({ code: 'BUSY', message: 'Back at 18:00' });
    expect(conn.closed).not.toBeNull();
  });

  it('a second connection from the same player replaces the first', () => {
    const { join } = makeHub();
    const first = join(player(1));
    const second = join(player(1));
    expect(first.closed?.code).toBe(4002);
    expect(second.last('welcome')).toBeDefined();
  });

  it('cleans up names and never exposes guest ids', () => {
    const { hub, join } = makeHub();
    const a = join({ ...player(1), name: '  Ann\u0000​   Lee  ' });
    const b = join({ ...player(2), name: 'sh1t head' });
    a.inbox.length = 0;
    hub.handle(a, { t: 'room.create', tc: TC, color: 'w' });
    hub.handle(b, { t: 'room.join', code: a.last('room.created')!.code });
    const start = a.last('game.start')!;
    expect(start.white.name).toBe('Ann Lee');
    expect(start.black.name).toBe('Player');
    expect(JSON.stringify(a.inbox)).not.toContain(player(2).guestId);
    expect(start.black.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('Hub: invite codes', () => {
  it('create, share, join: the game starts for both with the host’s colour', () => {
    const { hub, join } = makeHub();
    const host = join(player(1));
    const guest = join(player(2));
    hub.handle(host, { t: 'room.create', tc: TC, color: 'b' });
    const { code } = host.last('room.created')!;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    hub.handle(guest, {
      t: 'room.join',
      code: ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `,
    });
    expect(host.last('game.start')).toMatchObject({ color: 'b', tc: TC });
    expect(guest.last('game.start')).toMatchObject({ color: 'w' });
    expect(hub.stats()).toMatchObject({ rooms: 0, liveGames: 1 });
  });

  it('unknown, own and expired codes are refused', () => {
    const { hub, timers, join } = makeHub();
    const host = join(player(1));
    const guest = join(player(2));
    hub.handle(guest, { t: 'room.join', code: 'ZZZZZZ' });
    expect(guest.last('error')).toMatchObject({ code: 'NOT_FOUND' });
    hub.handle(host, { t: 'room.create', tc: TC, color: 'random' });
    const { code } = host.last('room.created')!;
    hub.handle(host, { t: 'room.join', code });
    expect(host.last('error')).toMatchObject({ code: 'BAD_MSG' });
    timers.advance(10 * 60_000);
    expect(host.last('room.closed')).toMatchObject({ code, reason: 'expired' });
    hub.handle(guest, { t: 'room.join', code });
    expect(guest.last('error')).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a code stays valid for a minute while the host reconnects', () => {
    const { hub, timers, join } = makeHub();
    const host = join(player(1));
    hub.handle(host, { t: 'room.create', tc: TC, color: 'w' });
    const { code } = host.last('room.created')!;
    hub.disconnect(host);
    timers.advance(30_000);
    const back = join(player(1));
    expect(back.last('room.created')?.code).toBe(code);
    hub.disconnect(back);
    timers.advance(60_000);
    expect(hub.stats().rooms).toBe(0);
  });

  it('cancel closes the room', () => {
    const { hub, join } = makeHub();
    const host = join(player(1));
    hub.handle(host, { t: 'room.create', tc: TC, color: 'w' });
    hub.handle(host, { t: 'room.cancel' });
    expect(host.last('room.closed')).toMatchObject({ reason: 'cancelled' });
  });

  it('limits new rooms to 5 a minute and refuses very short clocks', () => {
    const { hub, join } = makeHub();
    const host = join(player(1));
    for (let i = 0; i < 5; i++) hub.handle(host, { t: 'room.create', tc: TC, color: 'w' });
    hub.handle(host, { t: 'room.create', tc: TC, color: 'w' });
    expect(host.last('error')).toMatchObject({ code: 'RATE_LIMIT' });
    expect(hub.stats().rooms).toBe(1);
    const other = join(player(2));
    hub.handle(other, { t: 'room.create', tc: { baseMs: 10_000, incMs: 0 }, color: 'w' });
    expect(other.last('error')).toMatchObject({ code: 'BAD_MSG' });
  });
});

describe('Hub: quick match', () => {
  it('pairs the two players in the same pool', () => {
    const { hub, join } = makeHub();
    const a = join(player(1));
    const b = join(player(2));
    const c = join(player(3));
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    expect(a.last('queue.waiting')).toBeDefined();
    hub.handle(c, { t: 'queue.join', tc: QUICK_MATCH_POOLS[0]! });
    hub.handle(b, { t: 'queue.join', tc: BLITZ });
    expect(a.last('game.start')).toBeDefined();
    expect(b.last('game.start')).toBeDefined();
    expect(c.last('game.start')).toBeUndefined();
    expect(hub.stats().waiting).toBe(1);
  });

  it('only offers the fixed pools', () => {
    const { hub, join } = makeHub();
    const a = join(player(1));
    hub.handle(a, { t: 'queue.join', tc: { baseMs: 123_000, incMs: 0 } });
    expect(a.last('error')).toMatchObject({ code: 'BAD_MSG' });
  });

  it('pairs whoever is waiting, including the last opponent', () => {
    const { hub, join } = makeHub();
    const a = join(player(1));
    const b = join(player(2));
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    hub.handle(b, { t: 'queue.join', tc: BLITZ });
    hub.handle(a, { t: 'game.resign', gameId: a.last('game.start')!.gameId });
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    hub.handle(b, { t: 'queue.join', tc: BLITZ });
    expect(a.all('game.start')).toHaveLength(2);
    expect(b.all('game.start')).toHaveLength(2);
    expect(hub.stats().waiting).toBe(0);
  });

  it('leaving or disconnecting takes you out of the queue', () => {
    const { hub, join } = makeHub();
    const a = join(player(1));
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    hub.handle(a, { t: 'queue.leave' });
    expect(a.last('queue.left')).toBeDefined();
    const b = join(player(2));
    hub.handle(b, { t: 'queue.join', tc: BLITZ });
    hub.disconnect(b);
    expect(hub.stats().waiting).toBe(0);
  });

  it('one thing at a time: no queueing or hosting during a live game', () => {
    const { hub, join } = makeHub();
    const a = join(player(1));
    const b = join(player(2));
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    hub.handle(b, { t: 'queue.join', tc: BLITZ });
    hub.handle(a, { t: 'queue.join', tc: BLITZ });
    expect(a.last('error')).toMatchObject({ code: 'BUSY' });
    hub.handle(a, { t: 'room.create', tc: TC, color: 'w' });
    expect(a.last('error')).toMatchObject({ code: 'BUSY' });
    // Hosting a room and then queueing closes the room.
    const c = join(player(3));
    hub.handle(c, { t: 'room.create', tc: TC, color: 'w' });
    hub.handle(c, { t: 'queue.join', tc: BLITZ });
    expect(c.last('room.closed')).toMatchObject({ reason: 'cancelled' });
    expect(hub.stats().rooms).toBe(0);
  });
});

describe('Hub: playing', () => {
  function startedGame() {
    const env = makeHub();
    const w = env.join(player(1));
    const b = env.join(player(2));
    env.hub.handle(w, { t: 'room.create', tc: TC, color: 'w' });
    env.hub.handle(b, { t: 'room.join', code: w.last('room.created')!.code });
    const start = w.last('game.start')!;
    return {
      ...env,
      w,
      b,
      gameId: start.gameId,
      tokenW: start.token,
      tokenB: b.last('game.start')!.token,
    };
  }

  it('relays moves and keeps players out of games that are not theirs', () => {
    const { hub, join, w, b, gameId } = startedGame();
    hub.handle(w, { t: 'game.move', gameId, uci: 'e2e4', seq: 0 });
    expect(b.last('game.state')).toMatchObject({ seq: 1, moves: ['e2e4'] });
    const stranger = join(player(9));
    hub.handle(stranger, { t: 'game.move', gameId, uci: 'e7e5', seq: 1 });
    expect(stranger.last('error')).toMatchObject({ code: 'NOT_FOUND' });
    hub.handle(stranger, { t: 'game.rejoin', gameId, token: 'nope' });
    expect(stranger.last('error')).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejoining with the token restores the game after a disconnect', () => {
    const { hub, timers, join, w, b, gameId, tokenB } = startedGame();
    hub.handle(w, { t: 'game.move', gameId, uci: 'e2e4', seq: 0 });
    hub.handle(b, { t: 'game.move', gameId, uci: 'e7e5', seq: 1 });
    hub.disconnect(b);
    expect(w.last('game.opponentStatus')).toMatchObject({ connected: false });
    timers.advance(10_000);
    const back = join(player(2));
    hub.handle(back, { t: 'game.rejoin', gameId, token: 'wrong-token-123' });
    expect(back.last('error')).toMatchObject({ code: 'NOT_FOUND' });
    hub.handle(back, { t: 'game.rejoin', gameId, token: tokenB });
    expect(back.last('game.state')).toMatchObject({ seq: 2 });
    expect(back.last('game.start')).toMatchObject({ color: 'b' });
    expect(w.last('game.opponentStatus')).toMatchObject({ connected: true });
    hub.handle(back, { t: 'game.move', gameId, uci: 'd7d6', seq: 2 });
    expect(back.last('error')).toMatchObject({ code: 'NOT_YOUR_TURN' });
  });

  it('rematch: an offer, an accept, and colours swap', () => {
    const { hub, w, b, gameId } = startedGame();
    hub.handle(w, { t: 'game.resign', gameId });
    hub.handle(b, { t: 'game.rematch', gameId });
    expect(w.last('game.rematchOffer')).toMatchObject({ gameId });
    hub.handle(w, { t: 'game.rematchAccept', gameId });
    const next = w.last('game.start')!;
    expect(next.gameId).not.toBe(gameId);
    expect(next.color).toBe('b');
    hub.handle(w, { t: 'game.rematch', gameId });
    expect(w.last('error')).toMatchObject({ code: 'ILLEGAL' });
  });

  it('a declined rematch tells the player who asked', () => {
    const { hub, w, b, gameId } = startedGame();
    hub.handle(w, { t: 'game.abort', gameId });
    hub.handle(w, { t: 'game.rematch', gameId });
    hub.handle(b, { t: 'game.rematchDecline', gameId });
    expect(w.last('game.rematchDeclined')).toMatchObject({ gameId });
  });

  it('a rematch during a game is refused', () => {
    const { hub, w, gameId } = startedGame();
    hub.handle(w, { t: 'game.rematch', gameId });
    expect(w.last('error')).toMatchObject({ code: 'ILLEGAL' });
  });

  it('finished games are forgotten after 10 minutes', () => {
    const { hub, timers, w, gameId } = startedGame();
    hub.handle(w, { t: 'game.resign', gameId });
    expect(hub.game(gameId)).toBeDefined();
    timers.advance(10 * 60_000);
    expect(hub.game(gameId)).toBeUndefined();
  });

  it('draining: no new games, live ones end on shutdown', () => {
    const { hub, join, gameId, w } = startedGame();
    const waiting = join(player(5));
    hub.handle(waiting, { t: 'queue.join', tc: BLITZ });
    hub.startDraining();
    expect(waiting.last('queue.left')).toBeDefined();
    hub.handle(waiting, { t: 'queue.join', tc: BLITZ });
    expect(waiting.last('error')).toMatchObject({ code: 'BUSY' });
    hub.endAllGames();
    expect(w.last('game.over')).toMatchObject({ gameId, result: '*', reason: 'server-shutdown' });
  });
});
