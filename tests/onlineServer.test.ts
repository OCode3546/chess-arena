/**
 * The app's online client (connection + online store + board) against the real game server,
 * with a bot WebSocket client as the opponent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChessArenaApi, GameRecord, OnlineRejoin, ProfilesDoc } from '@shared/types';
import { Bot, player, testConfig } from '../server/test/helpers';
import { createGameServer, type GameServer } from '../server/src/server';

// The renderer's globals, as far as the online code uses them.
const listeners = new Map<string, () => void>();
let rejoinSaved: OnlineRejoin | null = null;
let serverUrl = '';
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.addEventListener = (type: string, fn: () => void) => listeners.set(type, fn);
g.removeEventListener = (type: string) => listeners.delete(type);
g.chessArena = {
  app: { getVersion: async () => '0.9.0' },
  online: {
    get serverUrl() {
      return serverUrl;
    },
    getIdentity: async () => ({ guestId: 'app-guest-0001-0002', displayName: 'Ana' }),
    setDisplayName: async (name: string) => ({ guestId: 'app-guest-0001-0002', displayName: name }),
    getRejoin: async () => rejoinSaved,
    setRejoin: async (r: OnlineRejoin) => {
      rejoinSaved = r;
      return true;
    },
    clearRejoin: async () => {
      rejoinSaved = null;
    },
  },
  storage: { setSettings: async () => ({}) },
} as unknown as ChessArenaApi;

const { useOnline, wireOnline } = await import('@/net/onlineStore');
const { useGameStore } = await import('@/store/gameStore');
const { setProfilePersistence, useProfiles } = await import('@/store/profileStore');

const online = () => useOnline.getState();
const board = () => useGameStore.getState();

async function until(cond: () => boolean, what: string, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let server: GameServer;
let url: string;
const records: GameRecord[] = [];
const docs: ProfilesDoc[] = [];
let unwire: () => void;

beforeAll(async () => {
  server = createGameServer(testConfig({ shutdownGraceMs: 0 }));
  const port = await server.listen();
  url = `ws://127.0.0.1:${port}/ws`;
  serverUrl = url;
  setProfilePersistence({ saveProfiles: (d) => docs.push(d), addRecord: (r) => records.push(r) });
  useProfiles.getState().hydrate({ activeId: null, profiles: [] });
  useProfiles.getState().create('Ana', 'knight-indigo');
  unwire = wireOnline();
  await online().connect();
  await until(() => online().status === 'online', 'connection');
});

afterAll(async () => {
  unwire();
  await server.shutdown();
});

// 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. O-O Nf6 6. c3 O-O 7. h3 h6 8. a3 a6 9. b4 Ba7 10. Nbd2 Be6
// prettier-ignore
const LINE = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'd2d3', 'd7d6', 'e1g1', 'g8f6',
  'c2c3', 'e8g8', 'h2h3', 'h7h6', 'a2a3', 'a7a6', 'b2b4', 'c5a7', 'b1d2', 'c8e6',
];

/** Play `moves` from the current ply: the app through the board, the bot over the wire. */
async function play(bot: Bot, moves: string[]): Promise<void> {
  const me = online().game!.color;
  for (const uci of moves) {
    const ply = board().history.length;
    const turn = ply % 2 === 0 ? 'w' : 'b';
    if (turn === me) {
      expect(board().attemptMove(uci.slice(0, 2) as never, uci.slice(2, 4) as never)).toBe('moved');
    } else {
      bot.send({ t: 'game.move', gameId: online().game!.gameId, uci, seq: ply });
    }
    await until(() => online().game?.state?.seq === ply + 1, `ply ${ply + 1}`);
    await until(() => board().history.length === ply + 1, `board ply ${ply + 1}`);
  }
}

describe('online client against the game server', { timeout: 20_000 }, () => {
  it('quick-matches, plays (castling included), survives a dropped link and settles XP', async () => {
    const bot = await Bot.join(url, player(1, 'Zed'));
    const tc = { baseMs: 3 * 60_000, incMs: 2_000 };
    online().findMatch(tc);
    await until(() => online().lobby.kind === 'queue', 'queue');
    bot.send({ t: 'queue.join', tc });
    await until(() => board().settings?.mode === 'online', 'game on the board');

    const game = online().game!;
    expect(rejoinSaved?.gameId).toBe(game.gameId);
    expect(online().shownGame).toBe(game.gameId);
    expect(board().orientation).toBe(game.color);
    const opp = game.color === 'w' ? game.black : game.white;
    expect(opp.name).toBe('Zed');
    expect(board().settings!.players[game.color === 'w' ? 'b' : 'w']).toMatchObject({
      name: 'Zed',
      level: 5,
    });

    await play(bot, LINE.slice(0, 10));
    expect(board().fen).toContain(' w ');
    expect(board().history[8]!.san).toBe('O-O');

    // Pull the cable: the app notices, reconnects, rejoins and the opponent sees it come back.
    listeners.get('offline')!();
    await bot.next('game.opponentStatus', (m) => !m.connected);
    const me = online().game!.color;
    const ply = board().history.length;
    if ((ply % 2 === 0 ? 'w' : 'b') === me) {
      // A move made while offline is sent once the link is back.
      board().attemptMove(LINE[ply]!.slice(0, 2) as never, LINE[ply]!.slice(2, 4) as never);
    }
    await until(() => online().status === 'online', 'reconnect', 8_000);
    await bot.next('game.opponentStatus', (m) => m.connected);
    await until(() => online().game?.state?.seq === board().history.length, 'resync');
    await play(bot, LINE.slice(board().history.length));
    expect(board().history.map((m) => m.lan)).toEqual(LINE);

    // Clocks agree with the server within the 500 ms the spec allows.
    const state = online().game!.state!;
    const turn = state.turn;
    const serverNow = state.clocks[turn] - (Date.now() - online().game!.anchor);
    board().tick();
    expect(Math.abs(board().clocks[turn] - serverNow)).toBeLessThan(500);

    // The opponent resigns at move 10: a win worth 80 + 10% (short) + 50 (first online win).
    bot.send({ t: 'game.resign', gameId: game.gameId });
    await until(() => board().status === 'over', 'game over');
    expect(board().result).toMatchObject({ winner: me, reason: 'resignation' });
    const profile = useProfiles.getState().profiles[0]!;
    expect(profile.xp).toBe(138);
    expect(profile.stats.online.wins).toBe(1);
    expect(records.at(-1)).toMatchObject({
      mode: 'online',
      onlineGameId: game.gameId,
      result: me === 'w' ? '1-0' : '0-1',
      moves: 10,
    });
    expect(rejoinSaved).toBeNull();
    expect(bot.invalid).toEqual([]);

    // Rematch: offered by the bot, accepted by the app; colours swap.
    bot.send({ t: 'game.rematch', gameId: game.gameId });
    await until(() => online().game?.rematch === 'received', 'rematch offer');
    online().rematch();
    await until(() => !!online().game && online().game!.gameId !== game.gameId, 'rematch game');
    await until(() => board().settings?.online?.gameId === online().game!.gameId, 'rematch board');
    expect(online().game!.color).not.toBe(me);
    expect(board().status).toBe('playing');

    // Abort before both sides have moved: no result, nothing recorded.
    const before = records.length;
    online().act('game.abort');
    await until(() => board().status === 'over', 'abort');
    expect(board().result).toMatchObject({ result: '*', reason: 'aborted' });
    expect(records).toHaveLength(before);
    bot.ws.close();
  });

  it('joins a private game by code and plays to a draw by agreement', async () => {
    const previous = online().game?.gameId;
    const host = await Bot.join(url, player(2, 'Host'));
    host.send({ t: 'room.create', tc: { baseMs: 60_000, incMs: 0 }, color: 'w' });
    const { code } = await host.next('room.created');
    expect(online().joinRoom('nope')).toMatch(/6 letters/);
    expect(online().joinRoom(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBeNull();
    await until(
      () =>
        online().game?.gameId !== previous &&
        board().settings?.online?.gameId === online().game?.gameId,
      'private game',
    );
    expect(online().game!.color).toBe('b');
    await play(host, ['e2e4', 'e7e5']);
    host.send({ t: 'game.drawOffer', gameId: online().game!.gameId });
    await until(() => online().game?.state?.drawOfferFrom === 'w', 'draw offer');
    online().act('game.drawAccept');
    await until(() => board().status === 'over', 'draw');
    expect(board().result).toMatchObject({ result: '1/2-1/2', reason: 'agreement' });
    // Under move 10: recorded, no XP.
    expect(records.at(-1)).toMatchObject({
      result: '1/2-1/2',
      xpAwarded: { [useProfiles.getState().profiles[0]!.id]: 0 },
    });
    host.ws.close();
  });

  it('reports unknown codes', async () => {
    online().joinRoom('ABCDEF');
    await until(() => online().lobbyError !== null, 'error');
    expect(online().lobbyError).toMatch(/not found|expired/i);
    expect(online().lobby.kind).toBe('idle');
  });
});
