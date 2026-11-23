import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import { create } from 'zustand';
import type { AssistsUsed, Color, GameSettings, SavedGame } from '@shared/types';
import {
  detectGameEnd,
  draw,
  other,
  START_FEN,
  timeoutResult,
  win,
  type GameResult,
} from '@/game/rules';

export type PromotionPiece = Extract<PieceSymbol, 'q' | 'r' | 'b' | 'n'>;

export interface GamePersistence {
  save(game: SavedGame): void;
  clear(): void;
}

let persistence: GamePersistence | null = null;
/** Wire the store to disk (the renderer passes the IPC-backed implementation). */
export function setGamePersistence(p: GamePersistence | null): void {
  persistence = p;
}

/** Receives the local player's moves in online games (the online store sends them). */
export type OnlineMoveSink = (gameId: string, uci: string, seq: number) => void;
let onlineMoveSink: OnlineMoveSink | null = null;
export function setOnlineMoveSink(sink: OnlineMoveSink | null): void {
  onlineMoveSink = sink;
}

/** The server's view of an online game, as the board should show it. */
export interface OnlineSnapshot {
  /** Every move so far in UCI. */
  moves: string[];
  /** Remaining time at `anchor`. */
  clocks: { w: number; b: number };
  clockRunning: boolean;
  /** Local time (Date.now() scale) the clocks were measured at. */
  anchor: number;
}

/** Display-only clock state of an online game; the server decides every flag. */
export interface OnlineClock {
  base: { w: number; b: number };
  anchor: number;
  /** A move of ours the server has not confirmed yet. */
  pending: { uci: string; seq: number } | null;
}

/** The single live chess.js instance; store state mirrors it. */
let chess = new Chess();

export interface GameState {
  status: 'idle' | 'playing' | 'over';
  settings: GameSettings | null;
  fen: string;
  history: Move[];
  startedAt: string;
  orientation: Color;
  selected: Square | null;
  legalTargets: Square[];
  pendingPromotion: { from: Square; to: Square } | null;
  clocks: { w: number; b: number };
  /** Clocks start after White's first move. */
  clockStarted: boolean;
  paused: boolean;
  lastTick: number | null;
  result: GameResult | null;
  /** Ply shown on the board while reviewing; null = live position. */
  viewPly: number | null;
  /** vs AI: hints and takebacks used so far (XP penalty). */
  assists: AssistsUsed;
  /** vs AI: the suggested move currently shown on the board. */
  hint: { from: Square; to: Square } | null;
  /** Online games only. */
  online: OnlineClock | null;

  newGame(settings: GameSettings, now?: number): void;
  /** Show an online game (settings.mode 'online'); its moves and clocks come from `syncOnline`. */
  startOnline(settings: GameSettings, snap: OnlineSnapshot): boolean;
  /**
   * Bring the online game in line with the server. Our own unconfirmed move is kept while
   * the server simply hasn't seen it yet; anything else the server says wins (with
   * `discardPending`, the server refused our move: roll it back). Returns false if the
   * server's moves could not be replayed.
   */
  syncOnline(gameId: string, snap: OnlineSnapshot, opts?: { discardPending?: boolean }): boolean;
  /** The server ended the online game. */
  finishOnline(gameId: string, result: GameResult): void;
  restore(saved: SavedGame): boolean;
  selectSquare(square: Square | null): void;
  /** Returns 'moved', 'promotion' (picker needed) or 'illegal'. */
  attemptMove(
    from: Square,
    to: Square,
    opts?: { autoQueen?: boolean; now?: number },
  ): 'moved' | 'promotion' | 'illegal';
  choosePromotion(piece: PromotionPiece, now?: number): void;
  /** vs AI: play the engine's move (UCI). Returns false if it is not the AI's turn or illegal. */
  applyAiMove(uci: string, now?: number): boolean;
  /** vs AI: take back the human's last move (and the AI's reply). */
  undo(now?: number): boolean;
  /** vs AI: show a suggested move and count it as a used hint. */
  showHint(from: Square, to: Square): void;
  cancelPromotion(): void;
  tick(now?: number): void;
  setPaused(paused: boolean, now?: number): void;
  resign(color: Color): void;
  agreeDraw(): void;
  flip(): void;
  setViewPly(ply: number | null): void;
  toSavedGame(): SavedGame | null;
  /** Write the current game to disk (no-op when not in progress). Pass `now` to settle the clock first. */
  persist(now?: number): void;
  reset(): void;
}

const isTimed = (s: GameSettings | null) => !!s && s.timeControl.initialMs > 0;

const initial = {
  status: 'idle' as const,
  settings: null,
  fen: START_FEN,
  history: [] as Move[],
  startedAt: new Date(0).toISOString(),
  orientation: 'w' as Color,
  selected: null,
  legalTargets: [] as Square[],
  pendingPromotion: null,
  clocks: { w: 0, b: 0 },
  clockStarted: false,
  paused: false,
  lastTick: null,
  result: null,
  viewPly: null,
  assists: { hints: 0, undos: 0 },
  hint: null,
  online: null,
};

/** The side the computer plays, or null outside vs-AI games. */
export function aiColorOf(settings: GameSettings | null): Color | null {
  if (!settings || settings.mode !== 'pvai' || !settings.humanColor) return null;
  return other(settings.humanColor);
}

const startOrientation = (settings: GameSettings): Color =>
  settings.mode === 'pvai' && settings.humanColor ? settings.humanColor : 'w';

function legalTargetsFrom(square: Square): Square[] {
  return chess.moves({ square, verbose: true }).map((m) => m.to);
}

const EVENT: Record<GameSettings['mode'], string> = {
  pvp: 'Chess Arena — local game',
  pvai: 'Chess Arena — vs AI',
  online: 'Chess Arena online game',
};

const isOnline = (s: GameSettings | null | undefined) => s?.mode === 'online';

/** The online game the store is showing, if it is `gameId`. */
const showsOnline = (s: Pick<GameState, 'settings'>, gameId: string) =>
  s.settings?.mode === 'online' && s.settings.online?.gameId === gameId;

/** Replay UCI moves on a game; false if one is illegal. */
function playUci(c: Chess, moves: string[]): boolean {
  for (const uci of moves) {
    try {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
  }
  return true;
}

function applyPgnHeaders(settings: GameSettings, startedAt: string): void {
  chess.setHeader('Event', EVENT[settings.mode]);
  chess.setHeader('Site', 'Chess Arena');
  chess.setHeader('Date', startedAt.slice(0, 10).replace(/-/g, '.'));
  chess.setHeader('White', settings.players.w.name);
  chess.setHeader('Black', settings.players.b.name);
  if (settings.timeControl.initialMs > 0) {
    chess.setHeader(
      'TimeControl',
      `${settings.timeControl.initialMs / 1000}+${settings.timeControl.incrementMs / 1000}`,
    );
  }
}

export const useGameStore = create<GameState>()((set, get) => {
  /** Finish the game: record the result and drop the auto-save. */
  const finish = (result: GameResult) => {
    chess.setHeader('Result', result.result);
    set({
      status: 'over',
      result,
      selected: null,
      legalTargets: [],
      pendingPromotion: null,
      lastTick: null,
    });
    // Online games are never saved, so a saved local game stays where it is.
    if (!isOnline(get().settings)) persistence?.clear();
  };

  /** Online: show our move at once and send it; the server confirms or corrects it. */
  const commitOnlineMove = (
    from: Square,
    to: Square,
    promotion: PromotionPiece | undefined,
    now: number,
  ) => {
    const s = get();
    const seat = s.settings?.online;
    if (!seat || !s.online) return;
    get().tick(now);
    const seq = chess.history().length;
    const move = chess.move({ from, to, promotion });
    const clocks = { ...get().clocks };
    // The server adds the increment only once the clocks are running.
    if (s.clockStarted) clocks[move.color] += s.settings!.timeControl.incrementMs;
    set({
      fen: chess.fen(),
      history: chess.history({ verbose: true }),
      selected: null,
      legalTargets: [],
      pendingPromotion: null,
      clocks,
      clockStarted: true,
      viewPly: null,
      online: { base: clocks, anchor: now, pending: { uci: move.lan, seq } },
    });
    onlineMoveSink?.(seat.gameId, move.lan, seq);
  };

  const commitMove = (
    from: Square,
    to: Square,
    promotion: PromotionPiece | undefined,
    now: number,
  ) => {
    const state = get();
    if (isOnline(state.settings)) return commitOnlineMove(from, to, promotion, now);
    const mover = chess.turn();
    const clocks = { ...state.clocks };
    let clockStarted = state.clockStarted;
    if (isTimed(state.settings)) {
      if (clockStarted) {
        const elapsed = state.lastTick === null ? 0 : Math.max(0, now - state.lastTick);
        clocks[mover] = Math.max(0, clocks[mover] - elapsed);
        if (clocks[mover] === 0) {
          set({ clocks });
          finish(timeoutResult(chess, mover));
          return;
        }
        clocks[mover] += state.settings!.timeControl.incrementMs;
      } else if (mover === 'w') {
        clockStarted = true;
      }
    }
    chess.move({ from, to, promotion });
    const next = chess.turn();
    set({
      fen: chess.fen(),
      history: chess.history({ verbose: true }),
      selected: null,
      legalTargets: [],
      pendingPromotion: null,
      clocks,
      clockStarted,
      lastTick: now,
      viewPly: null,
      hint: null,
      orientation:
        state.settings?.autoFlip && state.settings.mode === 'pvp' ? next : state.orientation,
    });
    const end = detectGameEnd(chess);
    if (end) finish(end);
    else get().persist();
  };

  const canInteract = () => {
    const s = get();
    if (s.status !== 'playing' || s.paused || s.viewPly !== null) return false;
    if (isOnline(s.settings))
      return chess.turn() === s.settings!.online?.color && !s.online?.pending;
    return chess.turn() !== aiColorOf(s.settings);
  };

  return {
    ...initial,

    newGame(settings, now = Date.now()) {
      chess = new Chess();
      const startedAt = new Date(now).toISOString();
      applyPgnHeaders(settings, startedAt);
      const t = settings.timeControl.initialMs;
      set({
        ...initial,
        status: 'playing',
        settings,
        startedAt,
        fen: chess.fen(),
        clocks: { w: t, b: t },
        orientation: startOrientation(settings),
      });
      get().persist();
    },

    startOnline(settings, snap) {
      if (!settings.online) return false;
      chess = new Chess();
      const startedAt = new Date().toISOString();
      applyPgnHeaders(settings, startedAt);
      set({
        ...initial,
        status: 'playing',
        settings,
        startedAt,
        fen: chess.fen(),
        clocks: { ...snap.clocks },
        orientation: settings.online.color,
        online: { base: { ...snap.clocks }, anchor: snap.anchor, pending: null },
      });
      return get().syncOnline(settings.online.gameId, snap);
    },

    syncOnline(gameId, snap, opts = {}) {
      const s = get();
      if (!showsOnline(s, gameId) || !s.online) return false;
      const local = chess.history({ verbose: true }).map((m) => m.lan);
      const isPrefix = (a: string[], b: string[]) => a.every((m, i) => b[i] === m);
      const pending = opts.discardPending ? null : s.online.pending;

      // The server hasn't seen our move yet (e.g. this is the opponent's draw offer): keep it.
      if (
        pending &&
        snap.moves.length === pending.seq &&
        local.length === pending.seq + 1 &&
        local[pending.seq] === pending.uci &&
        isPrefix(snap.moves, local)
      ) {
        return true;
      }

      let changed = false;
      if (local.length !== snap.moves.length || !isPrefix(local, snap.moves)) {
        changed = true;
        if (!isPrefix(local, snap.moves)) {
          const headers = chess.getHeaders();
          chess = new Chess();
          for (const [k, v] of Object.entries(headers)) if (v) chess.setHeader(k, v);
          if (!playUci(chess, snap.moves)) return false;
        } else if (!playUci(chess, snap.moves.slice(local.length))) {
          return false;
        }
      }
      const clocks = { ...snap.clocks };
      if (snap.clockRunning) {
        const turn = chess.turn();
        clocks[turn] = Math.max(0, clocks[turn] - Math.max(0, Date.now() - snap.anchor));
      }
      set({
        ...(changed && {
          fen: chess.fen(),
          history: chess.history({ verbose: true }),
          selected: null,
          legalTargets: [],
          pendingPromotion: null,
          hint: null,
        }),
        clocks,
        clockStarted: snap.clockRunning,
        online: { base: { ...snap.clocks }, anchor: snap.anchor, pending: null },
      });
      return true;
    },

    finishOnline(gameId, result) {
      const s = get();
      if (!showsOnline(s, gameId) || s.status !== 'playing') return;
      set({ clockStarted: false, online: s.online && { ...s.online, pending: null } });
      finish(result);
    },

    restore(saved) {
      const c = new Chess();
      try {
        c.loadPgn(saved.pgn);
      } catch {
        return false;
      }
      if (c.fen() !== saved.fen) return false;
      if (detectGameEnd(c)) return false;
      chess = c;
      const timed = isTimed(saved.settings);
      set({
        ...initial,
        status: 'playing',
        settings: saved.settings,
        startedAt: saved.startedAt,
        fen: c.fen(),
        history: c.history({ verbose: true }),
        clocks: { ...saved.clocks },
        clockStarted: saved.clockStarted,
        orientation:
          saved.settings.autoFlip && saved.settings.mode === 'pvp'
            ? c.turn()
            : startOrientation(saved.settings),
        assists: { hints: saved.assists?.hints ?? 0, undos: saved.assists?.undos ?? 0 },
        // Resume paused so no time is lost before the player is ready.
        paused: timed && saved.clockStarted,
      });
      return true;
    },

    selectSquare(square) {
      if (!square || !canInteract()) {
        set({ selected: null, legalTargets: [] });
        return;
      }
      const piece = chess.get(square);
      if (!piece || piece.color !== chess.turn()) {
        set({ selected: null, legalTargets: [] });
        return;
      }
      set({ selected: square, legalTargets: legalTargetsFrom(square) });
    },

    attemptMove(from, to, opts = {}) {
      if (!canInteract() || get().pendingPromotion) return 'illegal';
      const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (candidates.length === 0) return 'illegal';
      const now = opts.now ?? Date.now();
      if (candidates[0]!.isPromotion()) {
        if (opts.autoQueen) {
          commitMove(from, to, 'q', now);
          return 'moved';
        }
        set({ pendingPromotion: { from, to }, selected: null, legalTargets: [] });
        return 'promotion';
      }
      commitMove(from, to, undefined, now);
      return 'moved';
    },

    choosePromotion(piece, now = Date.now()) {
      const pending = get().pendingPromotion;
      if (!pending || get().status !== 'playing') return;
      commitMove(pending.from, pending.to, piece, now);
    },

    cancelPromotion() {
      set({ pendingPromotion: null });
    },

    applyAiMove(uci, now = Date.now()) {
      const s = get();
      if (s.status !== 'playing' || s.paused || chess.turn() !== aiColorOf(s.settings))
        return false;
      const move = chess.moves({ verbose: true }).find((m) => m.lan === uci);
      if (!move) return false;
      commitMove(move.from, move.to, move.promotion as PromotionPiece | undefined, now);
      return true;
    },

    undo(now = Date.now()) {
      const s = get();
      const ai = aiColorOf(s.settings);
      if (s.status !== 'playing' || s.paused || !ai || !s.settings?.assists) return false;
      const plies = undoablePlies(s);
      if (plies === 0) return false;
      for (let i = 0; i < plies; i++) chess.undo();
      const history = chess.history({ verbose: true });
      const clockStarted = s.clockStarted && history.length > 0;
      set({
        fen: chess.fen(),
        history,
        selected: null,
        legalTargets: [],
        pendingPromotion: null,
        viewPly: null,
        hint: null,
        clockStarted,
        lastTick: clockStarted ? now : null,
        assists: { ...s.assists, undos: s.assists.undos + 1 },
      });
      get().persist();
      return true;
    },

    showHint(from, to) {
      const s = get();
      if (s.status !== 'playing' || !s.settings?.assists) return;
      set({ hint: { from, to }, assists: { ...s.assists, hints: s.assists.hints + 1 } });
      get().persist();
    },

    tick(now = Date.now()) {
      const s = get();
      if (s.status === 'playing' && s.online) {
        // Display only: run the side to move's clock from the last server reading.
        if (!s.clockStarted) return;
        const turn = chess.turn();
        const ms = Math.max(0, s.online.base[turn] - Math.max(0, now - s.online.anchor));
        if (ms !== s.clocks[turn]) set({ clocks: { ...s.clocks, [turn]: ms } });
        return;
      }
      if (s.status !== 'playing' || s.paused || !s.clockStarted || !isTimed(s.settings)) return;
      if (s.lastTick === null) {
        set({ lastTick: now });
        return;
      }
      const active = chess.turn();
      const remaining = Math.max(0, s.clocks[active] - Math.max(0, now - s.lastTick));
      set({ clocks: { ...s.clocks, [active]: remaining }, lastTick: now });
      if (remaining === 0) finish(timeoutResult(chess, active));
    },

    setPaused(paused, now = Date.now()) {
      const s = get();
      if (s.status !== 'playing' || s.paused === paused || isOnline(s.settings)) return;
      if (paused) {
        get().tick(now);
        if (get().status !== 'playing') return;
        set({ paused: true, lastTick: null, selected: null, legalTargets: [] });
        get().persist();
      } else {
        set({ paused: false, lastTick: now });
      }
    },

    // Online games are resigned and drawn through the server.
    resign(color) {
      if (get().status !== 'playing' || isOnline(get().settings)) return;
      finish(win(other(color), 'resignation'));
    },

    agreeDraw() {
      if (get().status !== 'playing' || isOnline(get().settings)) return;
      finish(draw('agreement'));
    },

    flip() {
      set((s) => ({ orientation: other(s.orientation) }));
    },

    setViewPly(ply) {
      const len = get().history.length;
      if (ply === null || ply >= len) set({ viewPly: null });
      else set({ viewPly: Math.max(0, ply), selected: null, legalTargets: [] });
    },

    toSavedGame() {
      const s = get();
      if (s.status !== 'playing' || !s.settings || isOnline(s.settings)) return null;
      return {
        fen: chess.fen(),
        pgn: chess.pgn(),
        clocks: { ...s.clocks },
        settings: s.settings,
        turn: chess.turn(),
        startedAt: s.startedAt,
        clockStarted: s.clockStarted,
        assists: { ...s.assists },
      };
    },

    persist(now) {
      if (now !== undefined) get().tick(now);
      const saved = get().toSavedGame();
      if (saved) persistence?.save(saved);
    },

    reset() {
      chess = new Chess();
      set({ ...initial });
    },
  };
});

/**
 * Plies a vs-AI takeback removes: on the human's turn their last move and the AI's
 * reply; while the AI is to move, just the human's move. 0 = nothing to take back.
 */
export function undoablePlies(s: Pick<GameState, 'settings' | 'history' | 'fen'>): number {
  const ai = aiColorOf(s.settings);
  if (!ai) return 0;
  const n = s.history.length;
  if (s.fen.split(' ')[1] === ai) return n >= 1 ? 1 : 0;
  return n >= 2 ? 2 : 0;
}

/** Start position + UCI moves of the live game, as engines want it. */
export function enginePosition(): { fen: string; moves: string[] } {
  const history = chess.history({ verbose: true });
  return { fen: history[0]?.before ?? chess.fen(), moves: history.map((m) => m.lan) };
}

/** The PGN of the current game (including headers and result). */
export function currentPgn(): string {
  return chess.pgn();
}

/** Side to move in the live game. */
export function sideToMove(): Color {
  return chess.turn();
}

export function isInCheck(): boolean {
  return chess.inCheck();
}

export function kingSquare(color: Color): Square | undefined {
  return chess.findPiece({ type: 'k', color })[0];
}
