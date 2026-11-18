import { WebSocket } from 'ws';
import {
  parseServerMsg,
  PROTOCOL_VERSION,
  WS_PATH,
  type ClientMsg,
  type PlayerHello,
  type ServerMsg,
  type Side,
  type TimeControl,
} from '@shared/protocol';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config';
import { Game } from '../src/game';
import { Hub, type Conn } from '../src/hub';
import type { Logger } from '../src/log';
import { createGameServer, type GameServer } from '../src/server';
import { FakeTimers } from '../src/time';

export const silentLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export const TC: TimeControl = { baseMs: 60_000, incMs: 2_000 };

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...DEFAULT_CONFIG,
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    idSecret: 'test-secret',
    minAppVersion: '0.9.0',
    ...overrides,
  };
}

export const player = (n: number, name = `Player ${n}`): PlayerHello => ({
  guestId: `guest-0000-${String(n).padStart(4, '0')}`,
  name,
  level: 5,
  avatarId: 'knight-indigo',
});

export const hello = (p: PlayerHello, appVersion = '0.9.0'): ClientMsg => ({
  t: 'hello',
  v: PROTOCOL_VERSION,
  appVersion,
  player: p,
});

// ---------------------------------------------------------------------------
// A Game with fake time, recording what each side receives.

export function makeGame(
  opts: { fen?: string; tc?: TimeControl; lag?: Partial<Record<Side, number>> } = {},
) {
  const timers = new FakeTimers();
  const sent: Record<Side, ServerMsg[]> = { w: [], b: [] };
  const ended: Game[] = [];
  const lag = { w: opts.lag?.w ?? 0, b: opts.lag?.b ?? 0 };
  const game = new Game({
    id: 'game-1',
    tc: opts.tc ?? TC,
    white: {
      guestId: 'white-guest',
      info: { id: 'w', name: 'Wendy', level: 3, avatarId: 'a' },
      token: 'tok-w',
    },
    black: {
      guestId: 'black-guest',
      info: { id: 'b', name: 'Boris', level: 4, avatarId: 'a' },
      token: 'tok-b',
    },
    timers,
    config: { graceMs: 60_000, firstMoveMs: 30_000, maxLagCreditMs: 500 },
    hooks: {
      send: (c, m) => sent[c].push(m),
      lagOf: (g) => (g === 'white-guest' ? lag.w : lag.b),
      ended: (g) => ended.push(g),
    },
    fen: opts.fen,
  });
  game.start();
  const last = <T extends ServerMsg['t']>(c: Side, t: T) =>
    [...sent[c]].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  /** Play moves alternately starting with whoever is to move; each `ms` apart. */
  const play = (moves: string[], ms = 0) => {
    for (const uci of moves) {
      timers.advance(ms);
      game.move(game.turn, uci, game.plies);
    }
  };
  return { game, timers, sent, ended, lag, last, play };
}

// ---------------------------------------------------------------------------
// A Conn that records messages, for driving the Hub directly.

export class FakeConn implements Conn {
  readonly inbox: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  lagMs = 0;
  send(msg: ServerMsg): void {
    this.inbox.push(msg);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as
      Extract<ServerMsg, { t: T }> | undefined;
  }
  all<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
}

export function makeHub(overrides: Partial<ServerConfig> = {}) {
  const timers = new FakeTimers();
  const hub = new Hub(testConfig(overrides), timers, silentLog);
  const join = (p: PlayerHello) => {
    const conn = new FakeConn();
    hub.connect(conn);
    hub.handle(conn, hello(p));
    return conn;
  };
  return { hub, timers, join };
}

// ---------------------------------------------------------------------------
// A real WebSocket client for integration tests.

export class Bot {
  readonly inbox: ServerMsg[] = [];
  /** Messages from the server that failed protocol validation (must stay empty). */
  readonly invalid: string[] = [];
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      const msg = parseServerMsg(text);
      if (msg) this.inbox.push(msg);
      else this.invalid.push(text);
      this.wake();
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      this.wake();
    });
  }

  static open(url: string): Promise<Bot> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const bot = new Bot(ws);
      ws.once('open', () => resolve(bot));
      ws.once('error', reject);
    });
  }

  /** Open and say hello; resolves after `welcome`. */
  static async join(url: string, p: PlayerHello): Promise<Bot> {
    const bot = await Bot.open(url);
    bot.send(hello(p));
    await bot.next('welcome');
    return bot;
  }

  send(msg: ClientMsg | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Take the first unread message of type `t` (optionally matching `pred`), waiting if needed. */
  next<T extends ServerMsg['t']>(
    t: T,
    pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerMsg, { t: T }>> {
    return this.nextMatch(
      (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>),
      timeoutMs,
      t,
    ) as Promise<Extract<ServerMsg, { t: T }>>;
  }

  /** Take the first unread message matching `pred`, waiting if needed. */
  async nextMatch(
    pred: (m: ServerMsg) => boolean,
    timeoutMs = 5_000,
    label = 'message',
  ): Promise<ServerMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(
          `Timed out waiting for ${label}; inbox: ${JSON.stringify(this.inbox.map((m) => m.t))}`,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Wait until the socket closes; resolves with the close code. */
  async closed(timeoutMs = 5_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error('Socket did not close');
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closeCode;
  }

  close(): void {
    this.ws.close();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<{
  server: GameServer;
  url: string;
  http: string;
}> {
  const server = createGameServer(testConfig(overrides), { log: silentLog });
  const port = await server.listen();
  return { server, url: `ws://127.0.0.1:${port}${WS_PATH}`, http: `http://127.0.0.1:${port}` };
}

/** Two bots in a private game: returns them as white and black. */
export async function pairByCode(url: string, a: PlayerHello, b: PlayerHello, tc = TC) {
  const host = await Bot.join(url, a);
  const guest = await Bot.join(url, b);
  host.send({ t: 'room.create', tc, color: 'w' });
  const { code } = await host.next('room.created');
  guest.send({ t: 'room.join', code: code.toLowerCase() });
  const start = await host.next('game.start');
  const guestStart = await guest.next('game.start');
  return {
    white: host,
    black: guest,
    gameId: start.gameId,
    tokens: { w: start.token, b: guestStart.token },
  };
}
