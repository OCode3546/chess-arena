/**
 * Online play protocol: JSON messages over a WebSocket, shared by the app and the game
 * server so both sides agree on every shape. Parsers return a clean copy of a valid
 * message (unknown fields dropped) or null.
 */

/** Bumped on breaking protocol changes; the server rejects other versions. */
export const PROTOCOL_VERSION = 1;
/** Largest message the server accepts from a client, in bytes. */
export const MAX_MESSAGE_BYTES = 4096;
/** Largest message the app accepts from the server (long games have long move lists and PGNs). */
export const MAX_SERVER_MESSAGE_BYTES = 128 * 1024;
/** WebSocket path on the game server. */
export const WS_PATH = '/ws';

export type Side = 'w' | 'b';

export interface TimeControl {
  baseMs: number;
  incMs: number;
}

/** Quick-match pools (3+2, 5+3, 10+0, 15+10). */
export const QUICK_MATCH_POOLS: readonly TimeControl[] = [
  { baseMs: 3 * 60_000, incMs: 2_000 },
  { baseMs: 5 * 60_000, incMs: 3_000 },
  { baseMs: 10 * 60_000, incMs: 0 },
  { baseMs: 15 * 60_000, incMs: 10_000 },
];

/** Invite codes avoid look-alike characters (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** "k7q-m2x " → "K7QM2X": what people type is forgiving about case, spaces and dashes. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** What the app tells the server about the local player. */
export interface PlayerHello {
  /** Random per-install id; never shown to other players. */
  guestId: string;
  name: string;
  level: number;
  avatarId: string;
}

/** What players see about each other. `id` is stable per player but is not their guestId. */
export interface PlayerInfo {
  id: string;
  name: string;
  level: number;
  avatarId: string;
}

export type OnlineResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export type OnlineEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'resignation'
  | 'agreement'
  | 'timeout'
  | 'timeout-insufficient'
  | 'abandonment'
  | 'aborted'
  | 'server-shutdown';

export type GameAction =
  | 'game.resign'
  | 'game.abort'
  | 'game.drawOffer'
  | 'game.drawAccept'
  | 'game.drawDecline'
  | 'game.rematch'
  | 'game.rematchAccept'
  | 'game.rematchDecline';

export type ClientMsg =
  | { t: 'hello'; v: number; appVersion: string; player: PlayerHello }
  | { t: 'room.create'; tc: TimeControl; color: Side | 'random' }
  | { t: 'room.join'; code: string }
  | { t: 'room.cancel' }
  | { t: 'queue.join'; tc: TimeControl }
  | { t: 'queue.leave' }
  | { t: 'game.rejoin'; gameId: string; token: string }
  | { t: 'game.move'; gameId: string; uci: string; seq: number }
  | { t: GameAction; gameId: string }
  | { t: 'ping'; ts: number };

export type ErrorCode =
  | 'BAD_MSG'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'ILLEGAL'
  | 'NOT_YOUR_TURN'
  | 'GAME_OVER'
  | 'RATE_LIMIT'
  | 'UPGRADE_REQUIRED'
  | 'BUSY';

export interface GameState {
  gameId: string;
  fen: string;
  /** Every move so far in UCI notation (`e2e4`, `e7e8q`). */
  moves: string[];
  /** Number of moves played; the next move must carry this as its `seq`. */
  seq: number;
  /** Remaining time at `serverTs`. */
  clocks: { w: number; b: number };
  /** Whether the side to move's clock is running. */
  clockRunning: boolean;
  turn: Side;
  serverTs: number;
  drawOfferFrom: Side | null;
}

export type ServerMsg =
  | { t: 'welcome'; protocol: number; serverTs: number; minAppVersion: string }
  | { t: 'room.created'; code: string; tc: TimeControl; expiresAt: number }
  | { t: 'room.closed'; code: string; reason: 'cancelled' | 'expired' }
  | { t: 'queue.waiting'; tc: TimeControl; since: number }
  | { t: 'queue.left' }
  | {
      t: 'game.start';
      gameId: string;
      /** Secret that lets this player rejoin the game after a disconnect. */
      token: string;
      color: Side;
      tc: TimeControl;
      white: PlayerInfo;
      black: PlayerInfo;
      serverTs: number;
    }
  | ({ t: 'game.state' } & GameState)
  | { t: 'game.opponentStatus'; gameId: string; connected: boolean; graceEndsAt: number | null }
  | {
      t: 'game.over';
      gameId: string;
      result: OnlineResult;
      winner: Side | null;
      reason: OnlineEndReason;
      pgn: string;
      plies: number;
    }
  | { t: 'game.rematchOffer'; gameId: string }
  | { t: 'game.rematchDeclined'; gameId: string }
  | { t: 'error'; code: ErrorCode; message: string; gameId?: string }
  | { t: 'pong'; ts: number; serverTs: number };

// ---------------------------------------------------------------------------
// Validation helpers

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max: number, re?: RegExp): v is string =>
  typeof v === 'string' && v.length <= max && (!re || re.test(v));
const isSide = (v: unknown): v is Side => v === 'w' || v === 'b';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const AVATAR_RE = /^[a-z0-9-]{1,40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]*)?$/;
const MAX_BASE_MS = 3 * 60 * 60_000;
const MAX_INC_MS = 60_000;

const GAME_ACTIONS: readonly string[] = [
  'game.resign',
  'game.abort',
  'game.drawOffer',
  'game.drawAccept',
  'game.drawDecline',
  'game.rematch',
  'game.rematchAccept',
  'game.rematchDecline',
] satisfies GameAction[];

const END_REASONS: readonly string[] = [
  'checkmate',
  'stalemate',
  'threefold',
  'fifty-move',
  'insufficient',
  'resignation',
  'agreement',
  'timeout',
  'timeout-insufficient',
  'abandonment',
  'aborted',
  'server-shutdown',
] satisfies OnlineEndReason[];

const ERROR_CODES: readonly string[] = [
  'BAD_MSG',
  'NOT_FOUND',
  'ROOM_FULL',
  'ILLEGAL',
  'NOT_YOUR_TURN',
  'GAME_OVER',
  'RATE_LIMIT',
  'UPGRADE_REQUIRED',
  'BUSY',
] satisfies ErrorCode[];

function timeControl(v: unknown): TimeControl | null {
  if (!isObj(v) || !isInt(v.baseMs, 1, MAX_BASE_MS) || !isInt(v.incMs, 0, MAX_INC_MS)) return null;
  return { baseMs: v.baseMs, incMs: v.incMs };
}

function playerHello(v: unknown): PlayerHello | null {
  if (!isObj(v)) return null;
  if (!isStr(v.guestId, 64, /^[A-Za-z0-9-]{8,64}$/)) return null;
  if (!isStr(v.name, 64) || !isInt(v.level, 1, 50) || !isStr(v.avatarId, 40, AVATAR_RE))
    return null;
  return { guestId: v.guestId, name: v.name, level: v.level, avatarId: v.avatarId };
}

function playerInfo(v: unknown): PlayerInfo | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id, 64, ID_RE) || !isStr(v.name, 64) || !isInt(v.level, 1, 50)) return null;
  if (!isStr(v.avatarId, 40, AVATAR_RE)) return null;
  return { id: v.id, name: v.name, level: v.level, avatarId: v.avatarId };
}

function clocks(v: unknown): { w: number; b: number } | null {
  if (!isObj(v) || !isNum(v.w) || !isNum(v.b)) return null;
  return { w: v.w, b: v.b };
}

/** Parse JSON text, refusing anything over the size limit. */
function parseJson(raw: string, maxBytes: number): Obj | null {
  if (raw.length > maxBytes) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) && typeof v.t === 'string' ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parsers

export function parseClientMsg(raw: string): ClientMsg | null {
  const m = parseJson(raw, MAX_MESSAGE_BYTES);
  if (!m) return null;
  switch (m.t) {
    case 'hello': {
      const player = playerHello(m.player);
      if (!isInt(m.v, 0, 1000) || !isStr(m.appVersion, 32, VERSION_RE) || !player) return null;
      return { t: 'hello', v: m.v, appVersion: m.appVersion, player };
    }
    case 'room.create': {
      const tc = timeControl(m.tc);
      const color = m.color;
      if (!tc || !(isSide(color) || color === 'random')) return null;
      return { t: 'room.create', tc, color };
    }
    case 'room.join':
      return isStr(m.code, 16) ? { t: 'room.join', code: m.code } : null;
    case 'room.cancel':
    case 'queue.leave':
      return { t: m.t };
    case 'queue.join': {
      const tc = timeControl(m.tc);
      return tc ? { t: 'queue.join', tc } : null;
    }
    case 'game.rejoin':
      return isStr(m.gameId, 64, ID_RE) && isStr(m.token, 64, ID_RE)
        ? { t: 'game.rejoin', gameId: m.gameId, token: m.token }
        : null;
    case 'game.move':
      return isStr(m.gameId, 64, ID_RE) && isStr(m.uci, 5, UCI_RE) && isInt(m.seq, 0, 10_000)
        ? { t: 'game.move', gameId: m.gameId, uci: m.uci, seq: m.seq }
        : null;
    case 'ping':
      return isNum(m.ts) ? { t: 'ping', ts: m.ts } : null;
    default:
      if (typeof m.t === 'string' && GAME_ACTIONS.includes(m.t) && isStr(m.gameId, 64, ID_RE)) {
        return { t: m.t as GameAction, gameId: m.gameId };
      }
      return null;
  }
}

function gameState(m: Obj): GameState | null {
  const c = clocks(m.clocks);
  if (!isStr(m.gameId, 64, ID_RE) || !isStr(m.fen, 100) || !c || !isSide(m.turn)) return null;
  if (!Array.isArray(m.moves) || !m.moves.every((x) => isStr(x, 5, UCI_RE))) return null;
  if (!isInt(m.seq, 0, 10_000) || typeof m.clockRunning !== 'boolean' || !isNum(m.serverTs)) {
    return null;
  }
  const offer = m.drawOfferFrom ?? null;
  if (offer !== null && !isSide(offer)) return null;
  return {
    gameId: m.gameId,
    fen: m.fen,
    moves: [...(m.moves as string[])],
    seq: m.seq,
    clocks: c,
    clockRunning: m.clockRunning,
    turn: m.turn,
    serverTs: m.serverTs,
    drawOfferFrom: offer,
  };
}

/** Server messages are validated too: the app never trusts what arrives over the network. */
export function parseServerMsg(raw: string): ServerMsg | null {
  const m = parseJson(raw, MAX_SERVER_MESSAGE_BYTES);
  if (!m) return null;
  switch (m.t) {
    case 'welcome':
      return isInt(m.protocol, 0, 1000) && isNum(m.serverTs) && isStr(m.minAppVersion, 32)
        ? {
            t: 'welcome',
            protocol: m.protocol,
            serverTs: m.serverTs,
            minAppVersion: m.minAppVersion,
          }
        : null;
    case 'room.created': {
      const tc = timeControl(m.tc);
      return isStr(m.code, 16) && tc && isNum(m.expiresAt)
        ? { t: 'room.created', code: m.code, tc, expiresAt: m.expiresAt }
        : null;
    }
    case 'room.closed':
      return isStr(m.code, 16) && (m.reason === 'cancelled' || m.reason === 'expired')
        ? { t: 'room.closed', code: m.code, reason: m.reason }
        : null;
    case 'queue.waiting': {
      const tc = timeControl(m.tc);
      return tc && isNum(m.since) ? { t: 'queue.waiting', tc, since: m.since } : null;
    }
    case 'queue.left':
      return { t: 'queue.left' };
    case 'game.start': {
      const tc = timeControl(m.tc);
      const white = playerInfo(m.white);
      const black = playerInfo(m.black);
      if (!isStr(m.gameId, 64, ID_RE) || !isStr(m.token, 64, ID_RE) || !isSide(m.color)) {
        return null;
      }
      if (!tc || !white || !black || !isNum(m.serverTs)) return null;
      return {
        t: 'game.start',
        gameId: m.gameId,
        token: m.token,
        color: m.color,
        tc,
        white,
        black,
        serverTs: m.serverTs,
      };
    }
    case 'game.state': {
      const s = gameState(m);
      return s ? { t: 'game.state', ...s } : null;
    }
    case 'game.opponentStatus': {
      const grace = m.graceEndsAt ?? null;
      return isStr(m.gameId, 64, ID_RE) &&
        typeof m.connected === 'boolean' &&
        (grace === null || isNum(grace))
        ? { t: 'game.opponentStatus', gameId: m.gameId, connected: m.connected, graceEndsAt: grace }
        : null;
    }
    case 'game.over': {
      const result = m.result;
      const winner = m.winner ?? null;
      if (!isStr(m.gameId, 64, ID_RE) || !isStr(m.pgn, MAX_SERVER_MESSAGE_BYTES)) return null;
      if (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2' && result !== '*') {
        return null;
      }
      if (!(winner === null || isSide(winner)) || !isInt(m.plies, 0, 10_000)) return null;
      if (typeof m.reason !== 'string' || !END_REASONS.includes(m.reason)) return null;
      return {
        t: 'game.over',
        gameId: m.gameId,
        result,
        winner,
        reason: m.reason as OnlineEndReason,
        pgn: m.pgn,
        plies: m.plies,
      };
    }
    case 'game.rematchOffer':
    case 'game.rematchDeclined':
      return isStr(m.gameId, 64, ID_RE) ? { t: m.t, gameId: m.gameId } : null;
    case 'error':
      if (typeof m.code !== 'string' || !ERROR_CODES.includes(m.code)) return null;
      if (!isStr(m.message, 500)) return null;
      return {
        t: 'error',
        code: m.code as ErrorCode,
        message: m.message,
        ...(isStr(m.gameId, 64, ID_RE) ? { gameId: m.gameId } : {}),
      };
    case 'pong':
      return isNum(m.ts) && isNum(m.serverTs)
        ? { t: 'pong', ts: m.ts, serverTs: m.serverTs }
        : null;
    default:
      return null;
  }
}

/** True when `version` (x.y.z) is at least `min`. Pre-release suffixes are ignored. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (s: string) =>
    s
      .split(/[-+]/)[0]!
      .split('.')
      .map((n) => Number(n) || 0);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
