import { Chess } from 'chess.js';
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseAiMove, type EnginePosition } from '@/ai/aiPlayer';
import type { Backend } from '@/ai/backends';
import { AiEngine } from '@/ai/engine';
import { minimaxSearch } from '@/ai/minimax';
import { detectGameEnd } from '@/game/rules';
import type { Difficulty } from '@shared/types';
import { NativeEngine } from '../electron/engine';
import { hostEngineBinary } from '../tests/engineBinary';

/**
 * Plays full games with the real native engine through the same policy code the
 * app uses. Clocks are simulated at 3 s per move so the 400 ms–2 s presets are
 * capped to 100 ms and the suite finishes in minutes.
 */
const binary = hostEngineBinary();
const native = new NativeEngine(binary);
const backend: Backend = {
  id: 'native',
  init: async () => {
    const s = await native.start();
    if (!s.ok) throw new Error(s.error);
  },
  search: (req) =>
    native.search({
      fen: req.fen,
      moves: req.moves,
      skill: req.skill,
      depth: req.depth,
      movetime: req.movetime,
    }),
  stop: () => native.stop(),
  dispose: () => undefined,
};
// Only the native backend: an illegal move would exhaust the list and fail the game.
const engine = new AiEngine(['native'], () => backend);
afterAll(() => native.dispose());

type Side = Difficulty | 'minimax';
const MAX_PLIES = 240;
const SIM_CLOCK_MS = 3_000;

async function playGame(white: Side, black: Side) {
  const chess = new Chess();
  const start = chess.fen();
  const moves: string[] = [];
  let illegal = 0;
  while (!detectGameEnd(chess) && moves.length < MAX_PLIES) {
    const side = chess.turn() === 'w' ? white : black;
    const pos: EnginePosition = { fen: start, moves: [...moves] };
    const uci =
      side === 'minimax'
        ? minimaxSearch(start, moves, { depth: 3, timeLimitMs: 2_000 }).bestmove
        : (await chooseAiMove(pos, side, { engine, remainingMs: SIM_CLOCK_MS })).move;
    const legal = chess.moves({ verbose: true }).some((m) => m.lan === uci);
    if (!legal) {
      illegal++;
      break;
    }
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    moves.push(uci);
  }
  const end = detectGameEnd(chess);
  return {
    winner: end?.winner ?? null,
    reason: end?.reason ?? 'adjudicated',
    plies: moves.length,
    illegal,
  };
}

describe.skipIf(!existsSync(binary))('AI simulation (native Stockfish)', () => {
  it('20 games across all difficulties with zero illegal moves', async () => {
    const pairs: [Difficulty, Difficulty][] = [
      ['beginner', 'easy'],
      ['easy', 'beginner'],
      ['medium', 'hard'],
      ['hard', 'medium'],
      ['expert', 'grandmaster'],
      ['grandmaster', 'expert'],
      ['beginner', 'grandmaster'],
      ['grandmaster', 'beginner'],
      ['easy', 'medium'],
      ['medium', 'easy'],
      ['hard', 'expert'],
      ['expert', 'hard'],
      ['beginner', 'beginner'],
      ['easy', 'easy'],
      ['medium', 'medium'],
      ['hard', 'hard'],
      ['beginner', 'hard'],
      ['expert', 'beginner'],
      ['grandmaster', 'medium'],
      ['easy', 'grandmaster'],
    ];
    let illegal = 0;
    for (const [w, b] of pairs) {
      const r = await playGame(w, b);
      illegal += r.illegal;
      console.log(`${w} vs ${b}: ${r.winner ?? 'draw'} (${r.reason}, ${r.plies} plies)`);
    }
    expect(illegal).toBe(0);
  });

  it('Grandmaster clearly beats Beginner', async () => {
    let gm = 0;
    const games = 6;
    for (let i = 0; i < games; i++) {
      const gmWhite = i % 2 === 0;
      const r = await playGame(
        gmWhite ? 'grandmaster' : 'beginner',
        gmWhite ? 'beginner' : 'grandmaster',
      );
      gm += r.winner === null ? 0.5 : (r.winner === 'w') === gmWhite ? 1 : 0;
    }
    console.log(`Grandmaster vs Beginner: ${gm}/${games}`);
    expect(gm / games).toBeGreaterThanOrEqual(0.9);
  });

  it('Beginner is beatable by a weak player (the built-in depth-3 minimax)', async () => {
    let mm = 0;
    const games = 6;
    for (let i = 0; i < games; i++) {
      const mmWhite = i % 2 === 0;
      const r = await playGame(mmWhite ? 'minimax' : 'beginner', mmWhite ? 'beginner' : 'minimax');
      mm += r.winner === null ? 0.5 : (r.winner === 'w') === mmWhite ? 1 : 0;
    }
    console.log(`Minimax vs Beginner: ${mm}/${games}`);
    expect(mm / games).toBeGreaterThanOrEqual(0.5);
  });
});
