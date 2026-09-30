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

  newGame(settings: GameSettings, now?: number): void;
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

function applyPgnHeaders(settings: GameSettings, startedAt: string): void {
  chess.setHeader(
    'Event',
    settings.mode === 'pvp' ? 'Chess Arena — local game' : 'Chess Arena — vs AI',
  );
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
    persistence?.clear();
  };

  const commitMove = (
    from: Square,
    to: Square,
    promotion: PromotionPiece | undefined,
    now: number,
  ) => {
    const state = get();
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
    return (
      s.status === 'playing' &&
      !s.paused &&
      s.viewPly === null &&
      chess.turn() !== aiColorOf(s.settings)
    );
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
      if (s.status !== 'playing' || s.paused === paused) return;
      if (paused) {
        get().tick(now);
        if (get().status !== 'playing') return;
        set({ paused: true, lastTick: null, selected: null, legalTargets: [] });
        get().persist();
      } else {
        set({ paused: false, lastTick: now });
      }
    },

    resign(color) {
      if (get().status !== 'playing') return;
      finish(win(other(color), 'resignation'));
    },

    agreeDraw() {
      if (get().status !== 'playing') return;
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
      if (s.status !== 'playing' || !s.settings) return null;
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
