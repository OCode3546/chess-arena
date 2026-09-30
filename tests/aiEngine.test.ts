import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { acceptsDraw, chooseAiMove, ResignTracker, searchFor } from '@/ai/aiPlayer';
import type { AiSearch, Backend } from '@/ai/backends';
import { AbortError, AiEngine } from '@/ai/engine';
import { minimaxSearch } from '@/ai/minimax';
import type { EngineBackend } from '@shared/types';
import type { SearchResult } from '@shared/uci';

const START = new Chess().fen();
const POS = { fen: START, moves: [] as string[] };

type Behaviour = 'ok' | 'init-fail' | 'search-fail' | 'illegal' | 'hang';

function fake(id: EngineBackend, behaviour: Behaviour, log: string[]): Backend {
  return {
    id,
    init: async () => {
      log.push(`init:${id}`);
      if (behaviour === 'init-fail') throw new Error('binary missing');
    },
    search: async (req: AiSearch): Promise<SearchResult> => {
      log.push(`search:${id}`);
      if (behaviour === 'search-fail') throw new Error('crashed');
      if (behaviour === 'illegal') return { bestmove: 'e2e5', score: 0 };
      if (behaviour === 'hang') return new Promise(() => undefined);
      return minimaxSearch(req.fen, req.moves, { depth: 1 });
    },
    stop: () => log.push(`stop:${id}`),
    dispose: () => log.push(`dispose:${id}`),
  };
}

function engineWith(behaviours: Partial<Record<EngineBackend, Behaviour>>, log: string[]) {
  return new AiEngine(['native', 'wasm', 'minimax'], (id) => fake(id, behaviours[id] ?? 'ok', log));
}

const req = searchFor('medium', POS, null);

describe('engine failover', () => {
  it('uses the native engine when it works', async () => {
    const log: string[] = [];
    const res = await engineWith({}, log).search(req);
    expect(res.backend).toBe('native');
    expect(log).toEqual(['init:native', 'search:native']);
  });

  it('falls back to WASM when the native engine cannot start', async () => {
    const log: string[] = [];
    const engine = engineWith({ native: 'init-fail' }, log);
    const changes: string[] = [];
    engine.onBackendChange((b) => changes.push(b));
    expect((await engine.search(req)).backend).toBe('wasm');
    expect(changes).toEqual(['wasm']);
  });

  it('fails over mid-game when a backend crashes, and stays on the new one', async () => {
    const log: string[] = [];
    const engine = engineWith({ native: 'search-fail', wasm: 'search-fail' }, log);
    expect((await engine.search(req)).backend).toBe('minimax');
    expect((await engine.search(req)).backend).toBe('minimax');
    expect(log.filter((l) => l === 'search:native')).toHaveLength(1);
  });

  it('never passes on an illegal engine move', async () => {
    const log: string[] = [];
    const res = await engineWith({ native: 'illegal' }, log).search(req);
    expect(res.backend).toBe('wasm');
    expect(new Chess().moves({ verbose: true }).some((m) => m.lan === res.bestmove)).toBe(true);
  });

  it('cancels a search without failing over', async () => {
    const log: string[] = [];
    const engine = engineWith({ native: 'hang' }, log);
    const controller = new AbortController();
    const p = engine.search(req, controller.signal);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(log).toContain('stop:native');
    expect(engine.backend).toBe('native');
  });
});

describe('AI move policy', () => {
  it('maps difficulties to engine limits', () => {
    expect(searchFor('easy', POS, null)).toMatchObject({ skill: 3, depth: 3 });
    expect(searchFor('hard', POS, null)).toMatchObject({ skill: 12, movetime: 400 });
    expect(searchFor('grandmaster', POS, null)).toMatchObject({ skill: 20, movetime: 2000 });
    const beginner = [0, 0.99].map((r) => searchFor('beginner', POS, null, () => r).depth);
    expect(beginner).toEqual([1, 2]);
  });

  it('never thinks longer than its clock allows', () => {
    expect(searchFor('grandmaster', POS, 30_000).movetime).toBe(1000);
    expect(searchFor('grandmaster', POS, 600_000).movetime).toBe(2000);
    expect(searchFor('medium', POS, 900).movetime).toBe(50);
  });

  it('Beginner sometimes plays a random legal move without asking the engine', async () => {
    const log: string[] = [];
    const engine = engineWith({}, log);
    const res = await chooseAiMove(POS, 'beginner', { engine, random: () => 0.1 });
    expect(res.random).toBe(true);
    expect(log).toEqual([]);
    const res2 = await chooseAiMove(POS, 'beginner', { engine, random: () => 0.9 });
    expect(res2.random).toBe(false);
  });

  it('accepts draws only when not better and after move 20', () => {
    expect(acceptsDraw(0, 10)).toBe(false);
    expect(acceptsDraw(0, 40)).toBe(true);
    expect(acceptsDraw(-400, 60)).toBe(true);
    expect(acceptsDraw(150, 60)).toBe(false);
    expect(acceptsDraw(null, 60)).toBe(false);
  });

  it('resigns after three hopeless evals, never on learner levels', () => {
    const t = new ResignTracker('hard');
    expect(t.record(-1200, 40)).toBe(false);
    expect(t.record(-1200, 42)).toBe(false);
    expect(t.record(-300, 44)).toBe(false);
    expect(t.record(-1200, 46)).toBe(false);
    expect(t.record(-1500, 48)).toBe(false);
    expect(t.record(-100_000, 50)).toBe(true);
    const easy = new ResignTracker('easy');
    for (let i = 0; i < 5; i++) expect(easy.record(-5000, 60 + i)).toBe(false);
  });
});
