import {
  normalizeRoomCode,
  PROTOCOL_VERSION,
  QUICK_MATCH_POOLS,
  versionAtLeast,
  type ClientMsg,
  type ErrorCode,
  type PlayerInfo,
  type ServerMsg,
  type Side,
  type TimeControl,
} from '@shared/protocol';
import type { ServerConfig } from './config';
import { Game, other } from './game';
import { newRoomCode, publicId, randomId, sameSecret } from './ids';
import type { Logger } from './log';
import { cleanLevel, cleanName } from './names';
import { SlidingWindow } from './rateLimit';
import type { Timers } from './time';

/** A client connection as the hub sees it (the WebSocket layer implements this). */
export interface Conn {
  send(msg: ServerMsg): void;
  close(code: number, reason: string): void;
  /** One-way network lag estimate in ms. */
  readonly lagMs: number;
}

/** WebSocket close codes the server uses (4000–4999 are application-defined). */
export const CLOSE = {
  upgradeRequired: 4000,
  busy: 4001,
  replaced: 4002,
  policy: 1008,
} as const;

interface Session {
  guestId: string;
  info: PlayerInfo;
  conn: Conn | null;
  /** Invite code of the room this player is hosting. */
  room: string | null;
  /** Quick-match pool key this player is waiting in. */
  pool: string | null;
  /** Live (unfinished) game. */
  gameId: string | null;
  roomLimit: SlidingWindow;
}

interface Room {
  code: string;
  host: string;
  tc: TimeControl;
  color: Side | 'random';
  expiresAt: number;
  expiryTimer: unknown;
  hostGraceTimer: unknown;
}

interface QueueEntry {
  guestId: string;
  since: number;
}

const poolKey = (tc: TimeControl) => `${tc.baseMs}+${tc.incMs}`;
const POOL_KEYS = new Set(QUICK_MATCH_POOLS.map(poolKey));

export interface HubStats {
  connections: number;
  players: number;
  liveGames: number;
  finishedGames: number;
  rooms: number;
  waiting: number;
}

/**
 * All server state lives here, in memory: players (by guest id), invite rooms, quick-match
 * queues and games. Socket-agnostic, so it can be driven directly in tests.
 */
export class Hub {
  private readonly sessions = new Map<string, Session>();
  private readonly connSession = new Map<Conn, Session | null>();
  private readonly rooms = new Map<string, Room>();
  private readonly queues = new Map<string, QueueEntry[]>();
  private readonly games = new Map<string, Game>();
  private readonly cleanupTimers = new Map<string, unknown>();
  private draining = false;

  constructor(
    private readonly config: ServerConfig,
    private readonly timers: Timers,
    private readonly log: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Connections

  connect(conn: Conn): void {
    this.connSession.set(conn, null);
  }

  disconnect(conn: Conn): void {
    const session = this.connSession.get(conn);
    this.connSession.delete(conn);
    if (!session || session.conn !== conn) return;
    session.conn = null;
    this.leaveQueue(session);
    if (session.room) {
      const room = this.rooms.get(session.room);
      if (room) {
        // Give the host a minute to come back before the code stops working.
        room.hostGraceTimer = this.timers.set(
          () => this.closeRoom(room, null),
          this.config.graceMs,
        );
      }
    }
    if (session.gameId) {
      const game = this.games.get(session.gameId);
      const color = game?.colorOf(session.guestId);
      if (game && color) game.disconnect(color);
    }
    this.dropIfIdle(session);
  }

  /** Handle one parsed message (`null` = malformed). Returns false if it was refused. */
  handle(conn: Conn, msg: ClientMsg | null): boolean {
    if (!this.connSession.has(conn)) return false;
    if (!msg) return this.error(conn, 'BAD_MSG', 'Malformed message.');
    if (msg.t === 'ping') {
      conn.send({ t: 'pong', ts: msg.ts, serverTs: this.timers.now() });
      return true;
    }
    if (msg.t === 'hello') return this.hello(conn, msg);
    const session = this.connSession.get(conn);
    if (!session) return this.error(conn, 'BAD_MSG', 'Say hello first.');

    switch (msg.t) {
      case 'room.create':
        return this.createRoom(session, msg.tc, msg.color);
      case 'room.join':
        return this.joinRoom(session, msg.code);
      case 'room.cancel':
        if (session.room) {
          const room = this.rooms.get(session.room);
          if (room) this.closeRoom(room, 'cancelled');
        }
        return true;
      case 'queue.join':
        return this.joinQueue(session, msg.tc);
      case 'queue.leave':
        this.leaveQueue(session);
        session.conn?.send({ t: 'queue.left' });
        return true;
      case 'game.rejoin':
        return this.rejoin(session, msg.gameId, msg.token);
      default:
        return this.gameAction(session, msg);
    }
  }

  // -------------------------------------------------------------------------
  // Hello / identity

  private hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): boolean {
    if (this.connSession.get(conn)) return this.error(conn, 'BAD_MSG', 'Already said hello.');
    if (msg.v !== PROTOCOL_VERSION || !versionAtLeast(msg.appVersion, this.config.minAppVersion)) {
      this.error(conn, 'UPGRADE_REQUIRED', 'Please update Chess Arena to play online.');
      conn.close(CLOSE.upgradeRequired, 'upgrade required');
      return false;
    }
    if (this.config.maintenanceMessage || this.draining) {
      const text =
        this.config.maintenanceMessage ?? 'The server is restarting. Try again in a minute.';
      this.error(conn, 'BUSY', text);
      conn.close(CLOSE.busy, 'busy');
      return false;
    }

    const { guestId } = msg.player;
    let session = this.sessions.get(guestId);
    if (!session) {
      session = {
        guestId,
        info: { id: '', name: '', level: 1, avatarId: '' },
        conn: null,
        room: null,
        pool: null,
        gameId: null,
        roomLimit: new SlidingWindow(this.config.roomsPerMinute, 60_000),
      };
      this.sessions.set(guestId, session);
    }
    // The same player connecting again (new window, or a reconnect before the old socket
    // timed out) takes over; the old connection is closed.
    const old = session.conn;
    if (old && old !== conn) {
      this.connSession.set(old, null);
      old.send({ t: 'error', code: 'BUSY', message: 'You connected from somewhere else.' });
      old.close(CLOSE.replaced, 'replaced');
      this.connSession.delete(old);
    }
    session.conn = conn;
    session.info = {
      id: publicId(guestId, this.config.idSecret),
      name: cleanName(msg.player.name),
      level: cleanLevel(msg.player.level),
      avatarId: msg.player.avatarId,
    };
    this.connSession.set(conn, session);
    conn.send({
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      serverTs: this.timers.now(),
      minAppVersion: this.config.minAppVersion,
    });

    // Back within the grace period: the hosted room is still open.
    const room = session.room ? this.rooms.get(session.room) : undefined;
    if (room) {
      if (room.hostGraceTimer !== null) this.timers.clear(room.hostGraceTimer);
      room.hostGraceTimer = null;
      conn.send({ t: 'room.created', code: room.code, tc: room.tc, expiresAt: room.expiresAt });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Rooms

  private createRoom(s: Session, tc: TimeControl, color: Side | 'random'): boolean {
    if (!this.canStartSomething(s)) return false;
    if (tc.baseMs < this.config.minBaseMs) {
      return this.error(s.conn, 'BAD_MSG', 'Games need at least one minute on the clock.');
    }
    if (!s.roomLimit.take(this.timers.now())) {
      return this.error(s.conn, 'RATE_LIMIT', 'Too many new games. Wait a minute and try again.');
    }
    this.leaveQueue(s);
    this.cancelOwnRoom(s);
    const code = newRoomCode((c) => this.rooms.has(c));
    const expiresAt = this.timers.now() + this.config.roomTtlMs;
    const room: Room = {
      code,
      host: s.guestId,
      tc,
      color,
      expiresAt,
      hostGraceTimer: null,
      expiryTimer: this.timers.set(() => this.closeRoom(room, 'expired'), this.config.roomTtlMs),
    };
    this.rooms.set(code, room);
    s.room = code;
    s.conn?.send({ t: 'room.created', code, tc, expiresAt });
    this.log.info('room.created', { room: code });
    return true;
  }

  private joinRoom(s: Session, rawCode: string): boolean {
    const room = this.rooms.get(normalizeRoomCode(rawCode));
    if (!room) return this.error(s.conn, 'NOT_FOUND', 'That code was not found or has expired.');
    if (room.host === s.guestId) {
      return this.error(s.conn, 'BAD_MSG', 'That is your own game — share the code with a friend.');
    }
    const host = this.sessions.get(room.host);
    if (!host?.conn) {
      return this.error(s.conn, 'NOT_FOUND', 'The player who made that game is offline right now.');
    }
    if (!this.canStartSomething(s)) return false;
    this.leaveQueue(s);
    this.cancelOwnRoom(s);
    this.removeRoom(room);
    host.room = null;
    const hostIsWhite = room.color === 'random' ? Math.random() < 0.5 : room.color === 'w';
    this.startGame(hostIsWhite ? host : s, hostIsWhite ? s : host, room.tc);
    return true;
  }

  private closeRoom(room: Room, reason: 'cancelled' | 'expired' | null): void {
    if (this.rooms.get(room.code) !== room) return;
    this.removeRoom(room);
    const host = this.sessions.get(room.host);
    if (host?.room === room.code) host.room = null;
    if (reason) host?.conn?.send({ t: 'room.closed', code: room.code, reason });
    if (host) this.dropIfIdle(host);
  }

  private removeRoom(room: Room): void {
    this.rooms.delete(room.code);
    this.timers.clear(room.expiryTimer);
    if (room.hostGraceTimer !== null) this.timers.clear(room.hostGraceTimer);
  }

  private cancelOwnRoom(s: Session): void {
    const room = s.room ? this.rooms.get(s.room) : undefined;
    if (room) this.closeRoom(room, 'cancelled');
    s.room = null;
  }

  // -------------------------------------------------------------------------
  // Quick match

  private joinQueue(s: Session, tc: TimeControl): boolean {
    const key = poolKey(tc);
    if (!POOL_KEYS.has(key))
      return this.error(s.conn, 'BAD_MSG', 'Unknown quick-match time control.');
    if (!this.canStartSomething(s)) return false;
    this.cancelOwnRoom(s);
    if (s.pool === key) {
      const entry = this.queues.get(key)?.find((e) => e.guestId === s.guestId);
      s.conn?.send({ t: 'queue.waiting', tc, since: entry?.since ?? this.timers.now() });
      return true;
    }
    this.leaveQueue(s);

    const queue = this.queues.get(key) ?? [];
    this.queues.set(key, queue);
    // Players are paired the moment a second one arrives, so a pool holds at most one.
    const entry = queue.shift();
    if (entry) {
      const opponent = this.sessions.get(entry.guestId)!;
      opponent.pool = null;
      const white = Math.random() < 0.5;
      this.startGame(white ? s : opponent, white ? opponent : s, tc);
      return true;
    }
    const since = this.timers.now();
    queue.push({ guestId: s.guestId, since });
    s.pool = key;
    s.conn?.send({ t: 'queue.waiting', tc, since });
    return true;
  }

  private leaveQueue(s: Session): void {
    if (!s.pool) return;
    const queue = this.queues.get(s.pool);
    if (queue) {
      const i = queue.findIndex((e) => e.guestId === s.guestId);
      if (i >= 0) queue.splice(i, 1);
      if (queue.length === 0) this.queues.delete(s.pool);
    }
    s.pool = null;
  }

  // -------------------------------------------------------------------------
  // Games

  private startGame(white: Session, black: Session, tc: TimeControl): Game {
    const id = randomId(9);
    const game = new Game({
      id,
      tc,
      white: { guestId: white.guestId, info: white.info, token: randomId(16) },
      black: { guestId: black.guestId, info: black.info, token: randomId(16) },
      timers: this.timers,
      config: this.config,
      hooks: {
        send: (color, msg) => this.sessions.get(game.seats[color].guestId)?.conn?.send(msg),
        lagOf: (guestId) => this.sessions.get(guestId)?.conn?.lagMs ?? 0,
        ended: (g) => this.gameEnded(g),
      },
    });
    this.games.set(id, game);
    white.gameId = id;
    black.gameId = id;
    this.log.info('game.start', { game: id, tc: poolKey(tc) });
    game.start();
    return game;
  }

  private gameEnded(game: Game): void {
    for (const seat of Object.values(game.seats)) {
      const s = this.sessions.get(seat.guestId);
      if (s?.gameId === game.id) s.gameId = null;
    }
    this.log.info('game.over', {
      game: game.id,
      result: game.outcome?.result,
      reason: game.outcome?.reason,
      plies: game.plies,
    });
    // Keep the finished game for a while so players can see the result after a reconnect
    // and offer a rematch.
    this.cleanupTimers.set(
      game.id,
      this.timers.set(() => {
        this.games.delete(game.id);
        this.cleanupTimers.delete(game.id);
        for (const seat of Object.values(game.seats)) {
          const s = this.sessions.get(seat.guestId);
          if (s) this.dropIfIdle(s);
        }
      }, this.config.finishedTtlMs),
    );
    for (const seat of Object.values(game.seats)) {
      const s = this.sessions.get(seat.guestId);
      if (s) this.dropIfIdle(s);
    }
  }

  private rejoin(s: Session, gameId: string, token: string): boolean {
    const game = this.games.get(gameId);
    const color = game?.colorOf(s.guestId);
    if (!game || !color || !sameSecret(game.seats[color].token, token)) {
      return this.error(s.conn, 'NOT_FOUND', 'That game is no longer available.');
    }
    if (!game.over) {
      this.leaveQueue(s);
      this.cancelOwnRoom(s);
      s.gameId = game.id;
    }
    game.reconnect(color);
    return true;
  }

  private gameAction(
    s: Session,
    msg: Exclude<
      ClientMsg,
      {
        t:
          | 'hello'
          | 'ping'
          | 'room.create'
          | 'room.join'
          | 'room.cancel'
          | 'queue.join'
          | 'queue.leave'
          | 'game.rejoin';
      }
    >,
  ): boolean {
    const game = this.games.get(msg.gameId);
    const color = game?.colorOf(s.guestId);
    if (!game || !color) return this.error(s.conn, 'NOT_FOUND', 'That game was not found.');
    switch (msg.t) {
      case 'game.move':
        game.move(color, msg.uci, msg.seq);
        break;
      case 'game.resign':
        game.resign(color);
        break;
      case 'game.abort':
        game.abort(color);
        break;
      case 'game.drawOffer':
        game.offerDraw(color);
        break;
      case 'game.drawAccept':
        game.acceptDraw(color);
        break;
      case 'game.drawDecline':
        game.declineDraw(color);
        break;
      case 'game.rematch':
      case 'game.rematchAccept':
        return this.rematch(s, game, color, msg.t === 'game.rematchAccept');
      case 'game.rematchDecline':
        if (game.rematchFrom === other(color)) {
          game.rematchFrom = null;
          this.sessions.get(game.seats[other(color)].guestId)?.conn?.send({
            t: 'game.rematchDeclined',
            gameId: game.id,
          });
        }
        break;
    }
    return true;
  }

  private rematch(s: Session, game: Game, color: Side, acceptOnly: boolean): boolean {
    if (!game.over || game.rematched) {
      return this.error(s.conn, 'ILLEGAL', 'A rematch is not possible for this game.');
    }
    const opp = this.sessions.get(game.seats[other(color)].guestId);
    if (!opp?.conn || opp.gameId) {
      return this.error(s.conn, 'NOT_FOUND', 'Your opponent is no longer available.');
    }
    if (!this.canStartSomething(s)) return false;
    if (game.rematchFrom === other(color)) {
      game.rematched = true;
      game.rematchFrom = null;
      for (const p of [s, opp]) {
        this.leaveQueue(p);
        this.cancelOwnRoom(p);
      }
      // Colours swap for the rematch.
      const newWhite = this.sessions.get(game.seats.b.guestId)!;
      const newBlack = this.sessions.get(game.seats.w.guestId)!;
      this.startGame(newWhite, newBlack, game.tc);
      return true;
    }
    if (acceptOnly) return this.error(s.conn, 'ILLEGAL', 'There is no rematch offer to accept.');
    if (game.rematchFrom === color) return true;
    game.rematchFrom = color;
    opp.conn.send({ t: 'game.rematchOffer', gameId: game.id });
    return true;
  }

  // -------------------------------------------------------------------------
  // Shutdown & stats

  get liveGames(): number {
    let n = 0;
    for (const g of this.games.values()) if (!g.over) n++;
    return n;
  }

  /** Stop accepting new rooms and matches; existing games play on. */
  startDraining(): void {
    this.draining = true;
    for (const room of [...this.rooms.values()]) this.closeRoom(room, 'cancelled');
    for (const s of this.sessions.values()) {
      if (s.pool) {
        this.leaveQueue(s);
        s.conn?.send({ t: 'queue.left' });
      }
    }
  }

  /** End every live game without a result (the process is about to exit). */
  endAllGames(): void {
    for (const g of this.games.values()) g.forceEnd('server-shutdown');
  }

  stats(): HubStats {
    let waiting = 0;
    for (const q of this.queues.values()) waiting += q.length;
    return {
      connections: this.connSession.size,
      players: this.sessions.size,
      liveGames: this.liveGames,
      finishedGames: this.games.size - this.liveGames,
      rooms: this.rooms.size,
      waiting,
    };
  }

  /** Tests: look inside a game. */
  game(id: string): Game | undefined {
    return this.games.get(id);
  }

  // -------------------------------------------------------------------------
  // Helpers

  /** Not in a live game and the server isn't shutting down. Reports why not. */
  private canStartSomething(s: Session): boolean {
    if (this.draining) {
      return this.error(s.conn, 'BUSY', 'The server is restarting. Try again in a minute.');
    }
    if (s.gameId) return this.error(s.conn, 'BUSY', 'Finish your current game first.');
    return true;
  }

  /** Forget offline players that have nothing going on. */
  private dropIfIdle(s: Session): void {
    if (s.conn || s.room || s.pool || s.gameId) return;
    for (const g of this.games.values()) if (g.colorOf(s.guestId)) return;
    this.sessions.delete(s.guestId);
  }

  private error(target: Conn | null, code: ErrorCode, message: string): false {
    target?.send({ t: 'error', code, message });
    return false;
  }
}
