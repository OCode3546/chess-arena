import { Chess } from 'chess.js';
import { detectGameEnd, timeoutResult } from '@game/rules';
import type {
  ErrorCode,
  GameState,
  OnlineEndReason,
  OnlineResult,
  PlayerInfo,
  ServerMsg,
  Side,
  TimeControl,
} from '@shared/protocol';
import type { ServerConfig } from './config';
import type { Timers } from './time';

export const other = (c: Side): Side => (c === 'w' ? 'b' : 'w');

/** Plies a player must wait between two draw offers. */
export const DRAW_OFFER_GAP = 10;

export interface Seat {
  guestId: string;
  info: PlayerInfo;
  /** Secret that lets this seat rejoin after a disconnect. */
  token: string;
  connected: boolean;
  graceEndsAt: number | null;
  graceTimer: unknown;
}

export interface GameHooks {
  /** Deliver a message to a seat (dropped if that player is offline). */
  send(color: Side, msg: ServerMsg): void;
  /** Current one-way network lag of a player, for the lag credit. */
  lagOf(guestId: string): number;
  /** The game just finished. */
  ended(game: Game): void;
}

export interface GameOutcome {
  result: OnlineResult;
  winner: Side | null;
  reason: OnlineEndReason;
}

export interface GameOptions {
  id: string;
  tc: TimeControl;
  white: Omit<Seat, 'connected' | 'graceEndsAt' | 'graceTimer'>;
  black: Omit<Seat, 'connected' | 'graceEndsAt' | 'graceTimer'>;
  timers: Timers;
  config: Pick<ServerConfig, 'graceMs' | 'firstMoveMs' | 'maxLagCreditMs'>;
  hooks: GameHooks;
  /** Tests only: start from another position. */
  fen?: string;
}

const TERMINATION: Partial<Record<OnlineEndReason, string>> = {
  timeout: 'Time forfeit',
  'timeout-insufficient': 'Time forfeit',
  abandonment: 'Abandoned',
  aborted: 'Unterminated',
  'server-shutdown': 'Unterminated',
};

/**
 * One online game, owned by the server: it validates every move, runs both clocks and
 * decides every result. Clients only send intents and render what comes back.
 */
export class Game {
  readonly id: string;
  readonly tc: TimeControl;
  readonly seats: Record<Side, Seat>;
  readonly startedAt: number;
  /** Who has offered a rematch after the game ended. */
  rematchFrom: Side | null = null;
  rematched = false;
  outcome: GameOutcome | null = null;
  endedAt: number | null = null;
  pgn = '';

  private readonly chess: Chess;
  private readonly moves: string[] = [];
  private readonly clocks: Record<Side, number>;
  private clockRunning = false;
  private turnStartedAt: number;
  private drawOffer: Side | null = null;
  private readonly lastDrawOfferAt: Partial<Record<Side, number>> = {};
  private flagTimer: unknown = null;
  private firstMoveTimer: unknown = null;
  private readonly timers: Timers;
  private readonly config: GameOptions['config'];
  private readonly hooks: GameHooks;

  constructor(opts: GameOptions) {
    this.id = opts.id;
    this.tc = opts.tc;
    this.timers = opts.timers;
    this.config = opts.config;
    this.hooks = opts.hooks;
    const seat = (s: GameOptions['white']): Seat => ({
      ...s,
      connected: true,
      graceEndsAt: null,
      graceTimer: null,
    });
    this.seats = { w: seat(opts.white), b: seat(opts.black) };
    this.chess = opts.fen ? new Chess(opts.fen) : new Chess();
    this.clocks = { w: opts.tc.baseMs, b: opts.tc.baseMs };
    this.startedAt = this.timers.now();
    this.turnStartedAt = this.startedAt;
  }

  get over(): boolean {
    return this.outcome !== null;
  }

  get plies(): number {
    return this.moves.length;
  }

  get turn(): Side {
    return this.chess.turn();
  }

  colorOf(guestId: string): Side | null {
    if (this.seats.w.guestId === guestId) return 'w';
    if (this.seats.b.guestId === guestId) return 'b';
    return null;
  }

  /** Tell both players the game has started and arm the first-move timer. */
  start(): void {
    for (const c of ['w', 'b'] as const) this.hooks.send(c, this.startMsg(c));
    this.broadcastState();
    this.armTimers();
  }

  startMsg(color: Side): ServerMsg {
    return {
      t: 'game.start',
      gameId: this.id,
      token: this.seats[color].token,
      color,
      tc: this.tc,
      white: this.seats.w.info,
      black: this.seats.b.info,
      serverTs: this.timers.now(),
    };
  }

  /** Remaining time of `color` right now. */
  remaining(color: Side, now = this.timers.now()): number {
    const running = this.clockRunning && !this.over && this.turn === color;
    return Math.max(0, this.clocks[color] - (running ? now - this.turnStartedAt : 0));
  }

  state(): GameState {
    const now = this.timers.now();
    return {
      gameId: this.id,
      fen: this.chess.fen(),
      moves: [...this.moves],
      seq: this.moves.length,
      clocks: { w: this.remaining('w', now), b: this.remaining('b', now) },
      clockRunning: this.clockRunning && !this.over,
      turn: this.turn,
      serverTs: now,
      drawOfferFrom: this.drawOffer,
    };
  }

  overMsg(): ServerMsg | null {
    if (!this.outcome) return null;
    return { t: 'game.over', gameId: this.id, ...this.outcome, pgn: this.pgn, plies: this.plies };
  }

  // -------------------------------------------------------------------------
  // Player actions

  move(color: Side, uci: string, seq: number): void {
    if (this.over) return this.reject(color, 'GAME_OVER', 'This game is already over.');
    if (seq < this.moves.length && this.moves[seq] === uci) {
      // A resend of a move we already have (e.g. after a reconnect): just resync.
      return this.hooks.send(color, { t: 'game.state', ...this.state() });
    }
    if (seq !== this.moves.length) {
      return this.reject(color, 'ILLEGAL', 'That move is out of date.', true);
    }
    if (this.turn !== color)
      return this.reject(color, 'NOT_YOUR_TURN', 'It is not your turn.', true);

    const now = this.timers.now();
    if (this.clockRunning) {
      const credit = Math.min(
        this.hooks.lagOf(this.seats[color].guestId),
        this.config.maxLagCreditMs,
      );
      const used = Math.max(0, now - this.turnStartedAt - credit);
      if (used >= this.clocks[color]) {
        this.clocks[color] = 0;
        return this.flag(color);
      }
      this.clocks[color] = this.clocks[color] - used;
    }

    let played;
    try {
      played = this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
    } catch {
      return this.reject(color, 'ILLEGAL', 'That move is not legal.', true);
    }
    this.moves.push(`${played.from}${played.to}${played.promotion ?? ''}`);
    if (this.clockRunning) this.clocks[color] += this.tc.incMs;
    // Clocks start once White has moved (as in local games).
    if (!this.clockRunning && this.moves.length >= 1) this.clockRunning = true;
    this.turnStartedAt = now;
    // Moving declines the opponent's draw offer.
    if (this.drawOffer === other(color)) this.drawOffer = null;

    const end = detectGameEnd(this.chess);
    if (end) return this.finish(end);
    this.broadcastState();
    this.armTimers();
  }

  resign(color: Side): void {
    if (this.over) return this.reject(color, 'GAME_OVER', 'This game is already over.');
    this.finish({
      result: color === 'w' ? '0-1' : '1-0',
      winner: other(color),
      reason: 'resignation',
    });
  }

  abort(color: Side): void {
    if (this.over) return this.reject(color, 'GAME_OVER', 'This game is already over.');
    if (this.moves.length >= 2) {
      return this.reject(color, 'ILLEGAL', 'Both players have moved — you can resign instead.');
    }
    this.finish({ result: '*', winner: null, reason: 'aborted' });
  }

  offerDraw(color: Side): void {
    if (this.over) return this.reject(color, 'GAME_OVER', 'This game is already over.');
    if (this.drawOffer === other(color)) return this.acceptDraw(color);
    if (this.drawOffer === color) return;
    const last = this.lastDrawOfferAt[color];
    if (last !== undefined && this.moves.length - last < DRAW_OFFER_GAP) {
      const wait = DRAW_OFFER_GAP - (this.moves.length - last);
      return this.reject(color, 'RATE_LIMIT', `You can offer a draw again in ${wait} moves.`);
    }
    this.drawOffer = color;
    this.lastDrawOfferAt[color] = this.moves.length;
    this.broadcastState();
  }

  acceptDraw(color: Side): void {
    if (this.over) return this.reject(color, 'GAME_OVER', 'This game is already over.');
    if (this.drawOffer !== other(color)) {
      return this.reject(color, 'ILLEGAL', 'There is no draw offer to accept.');
    }
    this.finish({ result: '1/2-1/2', winner: null, reason: 'agreement' });
  }

  declineDraw(color: Side): void {
    if (this.over || this.drawOffer !== other(color)) return;
    this.drawOffer = null;
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Connections

  disconnect(color: Side): void {
    const seat = this.seats[color];
    if (!seat.connected) return;
    seat.connected = false;
    if (this.over) return;
    const now = this.timers.now();
    seat.graceEndsAt = now + this.config.graceMs;
    seat.graceTimer = this.timers.set(() => this.graceExpired(color), this.config.graceMs);
    this.hooks.send(other(color), {
      t: 'game.opponentStatus',
      gameId: this.id,
      connected: false,
      graceEndsAt: seat.graceEndsAt,
    });
  }

  reconnect(color: Side): void {
    const seat = this.seats[color];
    const wasAway = !seat.connected;
    seat.connected = true;
    if (seat.graceTimer !== null) this.timers.clear(seat.graceTimer);
    seat.graceTimer = null;
    seat.graceEndsAt = null;
    this.hooks.send(color, this.startMsg(color));
    this.hooks.send(color, { t: 'game.state', ...this.state() });
    const opp = this.seats[other(color)];
    this.hooks.send(color, {
      t: 'game.opponentStatus',
      gameId: this.id,
      connected: opp.connected,
      graceEndsAt: opp.graceEndsAt,
    });
    const over = this.overMsg();
    if (over) this.hooks.send(color, over);
    else if (wasAway) {
      this.hooks.send(other(color), {
        t: 'game.opponentStatus',
        gameId: this.id,
        connected: true,
        graceEndsAt: null,
      });
    }
  }

  /** End the game without a result (server shutting down). */
  forceEnd(reason: 'server-shutdown'): void {
    if (!this.over) this.finish({ result: '*', winner: null, reason });
  }

  // -------------------------------------------------------------------------
  // Internals

  private graceExpired(color: Side): void {
    const seat = this.seats[color];
    seat.graceTimer = null;
    if (this.over || seat.connected) return;
    const bothGone = !this.seats[other(color)].connected;
    if (bothGone || this.moves.length < 2) {
      this.finish({ result: '*', winner: null, reason: 'aborted' });
    } else {
      this.finish({
        result: color === 'w' ? '0-1' : '1-0',
        winner: other(color),
        reason: 'abandonment',
      });
    }
  }

  private flag(color: Side): void {
    if (this.over) return;
    this.clocks[color] = 0;
    // A side that runs out before both players have moved just aborts the game.
    if (this.moves.length < 2) return this.finish({ result: '*', winner: null, reason: 'aborted' });
    this.finish(timeoutResult(this.chess, color));
  }

  /** (Re)schedule the flag timer for the side to move and the first-move timeout. */
  private armTimers(): void {
    if (this.flagTimer !== null) this.timers.clear(this.flagTimer);
    this.flagTimer = null;
    if (this.clockRunning) {
      const side = this.turn;
      const credit = Math.min(
        this.hooks.lagOf(this.seats[side].guestId),
        this.config.maxLagCreditMs,
      );
      const due = this.clocks[side] + credit;
      this.flagTimer = this.timers.set(() => this.onFlagTimer(side), due);
    }
    if (this.firstMoveTimer !== null) this.timers.clear(this.firstMoveTimer);
    this.firstMoveTimer = null;
    if (this.moves.length < 2) {
      this.firstMoveTimer = this.timers.set(() => {
        if (!this.over && this.moves.length < 2) {
          this.finish({ result: '*', winner: null, reason: 'aborted' });
        }
      }, this.config.firstMoveMs);
    }
  }

  private onFlagTimer(side: Side): void {
    this.flagTimer = null;
    if (this.over || this.turn !== side) return;
    const credit = Math.min(this.hooks.lagOf(this.seats[side].guestId), this.config.maxLagCreditMs);
    const left = this.clocks[side] - (this.timers.now() - this.turnStartedAt) + credit;
    if (left > 0) {
      this.flagTimer = this.timers.set(() => this.onFlagTimer(side), left);
      return;
    }
    this.flag(side);
  }

  private finish(outcome: GameOutcome | ReturnType<typeof timeoutResult>): void {
    if (this.over) return;
    const now = this.timers.now();
    if (this.clockRunning) {
      const side = this.turn;
      this.clocks[side] = Math.max(0, this.clocks[side] - (now - this.turnStartedAt));
    }
    this.clockRunning = false;
    this.drawOffer = null;
    this.outcome = {
      result: outcome.result,
      winner: outcome.winner,
      reason: outcome.reason,
    };
    this.endedAt = now;
    for (const t of [
      this.flagTimer,
      this.firstMoveTimer,
      this.seats.w.graceTimer,
      this.seats.b.graceTimer,
    ]) {
      if (t !== null) this.timers.clear(t);
    }
    this.flagTimer = this.firstMoveTimer = this.seats.w.graceTimer = this.seats.b.graceTimer = null;
    this.seats.w.graceEndsAt = this.seats.b.graceEndsAt = null;
    this.pgn = this.buildPgn();
    this.broadcastState();
    const over = this.overMsg()!;
    this.hooks.send('w', over);
    this.hooks.send('b', over);
    this.hooks.ended(this);
  }

  private buildPgn(): string {
    const date = new Date(Date.now());
    const pad = (n: number) => String(n).padStart(2, '0');
    const o = this.outcome!;
    this.chess.setHeader('Event', 'Chess Arena online game');
    this.chess.setHeader('Site', 'Chess Arena');
    this.chess.setHeader(
      'Date',
      `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`,
    );
    this.chess.setHeader('White', this.seats.w.info.name);
    this.chess.setHeader('Black', this.seats.b.info.name);
    this.chess.setHeader('Result', o.result);
    this.chess.setHeader('TimeControl', `${this.tc.baseMs / 1000}+${this.tc.incMs / 1000}`);
    this.chess.setHeader('Termination', TERMINATION[o.reason] ?? 'Normal');
    // chess.js leaves the movetext result as "*" until the game ends on the board.
    return this.chess.pgn().replace(/\s(\*|1-0|0-1|1\/2-1\/2)\s*$/, ` ${o.result}`);
  }

  private broadcastState(): void {
    const msg: ServerMsg = { t: 'game.state', ...this.state() };
    this.hooks.send('w', msg);
    this.hooks.send('b', msg);
  }

  private reject(color: Side, code: ErrorCode, message: string, resync = false): void {
    this.hooks.send(color, { t: 'error', code, message, gameId: this.id });
    if (resync) this.hooks.send(color, { t: 'game.state', ...this.state() });
  }
}
