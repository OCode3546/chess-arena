import type { Square } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { AI_MIN_MOVE_DELAY_MS } from '@/config/difficulty';
import { aiColorOf, enginePosition, useGameStore } from '@/store/gameStore';
import { toast } from '@/store/toastStore';
import { acceptsDraw, analyse, chooseAiMove, ResignTracker } from './aiPlayer';
import { AbortError } from './engine';

interface AiUiState {
  /** The AI is searching for its move. */
  thinking: boolean;
}

export const useAiUi = create<AiUiState>()(() => ({ thinking: false }));

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AbortError());
    });
  });

/** Plies to wait after a declined draw before the player may offer again. */
const DRAW_REOFFER_PLIES = 10;

/**
 * Drives the computer side of a vs-AI game: searches when it is the AI's turn
 * (cancelling on undo, pause, new game or leaving the screen), enforces the
 * minimum move delay, resigns lost positions, and serves hints and draw offers.
 */
export function useAiOpponent() {
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const fen = useGameStore((s) => s.fen);
  const settings = useGameStore((s) => s.settings);
  const startedAt = useGameStore((s) => s.startedAt);
  const plies = useGameStore((s) => s.history.length);
  const ai = aiColorOf(settings);
  const difficulty = settings?.difficulty;
  const turn = fen.split(' ')[1];
  const aiTurn = status === 'playing' && !paused && !!ai && turn === ai;

  const tracker = useRef<{ game: string; tracker: ResignTracker } | null>(null);

  useEffect(() => {
    if (!aiTurn || !ai || !difficulty) return;
    if (tracker.current?.game !== startedAt) {
      tracker.current = { game: startedAt, tracker: new ResignTracker(difficulty) };
    }
    const resign = tracker.current.tracker;
    const controller = new AbortController();
    const { signal } = controller;
    const started = Date.now();
    useAiUi.setState({ thinking: true });

    void (async () => {
      const game = useGameStore.getState;
      try {
        const s = game();
        const timed = (s.settings?.timeControl.initialMs ?? 0) > 0;
        const choice = await chooseAiMove(enginePosition(), difficulty, {
          remainingMs: timed ? s.clocks[ai] : null,
          signal,
        });
        const wait = AI_MIN_MOVE_DELAY_MS - (Date.now() - started);
        if (wait > 0) await sleep(wait, signal);
        if (signal.aborted) return;
        if (resign.record(choice.score, game().history.length)) {
          game().resign(ai);
          toast('Stockfish resigns.', 'info');
          return;
        }
        if (!game().applyAiMove(choice.move)) {
          console.error(`[engine] could not play ${choice.move}`);
        }
      } catch (err) {
        if (err instanceof AbortError || signal.aborted) return;
        console.error(err);
        toast('The computer could not find a move.', 'error');
      } finally {
        if (!signal.aborted) useAiUi.setState({ thinking: false });
      }
    })();

    return () => {
      controller.abort();
      useAiUi.setState({ thinking: false });
    };
  }, [aiTurn, ai, difficulty, fen, startedAt]);

  // Hints and draw offers belong to the current position; cancel them when it changes.
  const assist = useRef<AbortController | null>(null);
  const [hintPending, setHintPending] = useState(false);
  const [drawPending, setDrawPending] = useState(false);
  const [drawDeclinedAt, setDrawDeclinedAt] = useState<{ game: string; ply: number } | null>(null);
  useEffect(
    () => () => {
      assist.current?.abort();
      assist.current = null;
      setHintPending(false);
      setDrawPending(false);
    },
    [fen, status],
  );

  const humanTurn = status === 'playing' && !paused && !!ai && turn !== ai;

  const requestHint = useCallback(async () => {
    if (!humanTurn || assist.current) return;
    const controller = new AbortController();
    assist.current = controller;
    setHintPending(true);
    try {
      const res = await analyse(enginePosition(), { signal: controller.signal });
      if (controller.signal.aborted) return;
      useGameStore
        .getState()
        .showHint(res.bestmove.slice(0, 2) as Square, res.bestmove.slice(2, 4) as Square);
    } catch (err) {
      if (!(err instanceof AbortError)) toast('No hint is available right now.', 'warning');
    } finally {
      if (assist.current === controller) {
        assist.current = null;
        setHintPending(false);
      }
    }
  }, [humanTurn]);

  const offerDraw = useCallback(async () => {
    if (!humanTurn || assist.current) return;
    const controller = new AbortController();
    assist.current = controller;
    setDrawPending(true);
    try {
      const res = await analyse(enginePosition(), { signal: controller.signal, movetime: 400 });
      if (controller.signal.aborted) return;
      // The human is to move, so the engine's score is from their side.
      const aiEval = res.score === null ? null : -res.score;
      const game = useGameStore.getState();
      if (acceptsDraw(aiEval, game.history.length)) {
        game.agreeDraw();
      } else {
        setDrawDeclinedAt({ game: game.startedAt, ply: game.history.length });
        toast('Stockfish declines the draw offer.', 'info');
      }
    } catch (err) {
      if (!(err instanceof AbortError)) toast('The draw offer could not be answered.', 'warning');
    } finally {
      if (assist.current === controller) {
        assist.current = null;
        setDrawPending(false);
      }
    }
  }, [humanTurn]);

  const drawCooldown =
    !!drawDeclinedAt &&
    drawDeclinedAt.game === startedAt &&
    plies - drawDeclinedAt.ply < DRAW_REOFFER_PLIES;

  return {
    enabled: !!ai,
    humanTurn,
    requestHint,
    hintPending,
    offerDraw,
    drawPending,
    canOfferDraw: humanTurn && !drawPending && !drawCooldown,
  };
}
