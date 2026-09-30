import { Chess } from 'chess.js';
import type { EngineBackend } from '@shared/types';
import type { SearchResult } from '@shared/uci';
import { createBackend, type AiSearch, type Backend } from './backends';

export class AbortError extends Error {
  constructor() {
    super('Search cancelled');
    this.name = 'AbortError';
  }
}

export interface EngineResult extends SearchResult {
  backend: EngineBackend;
}

type Listener = (backend: EngineBackend, previous: EngineBackend | null, reason?: string) => void;

/** Whether `uci` is a legal move after `fen` + `moves`. */
export function isLegalUci(fen: string, moves: string[], uci: string): boolean {
  try {
    const chess = new Chess(fen);
    for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    return chess.moves({ verbose: true }).some((m) => m.lan === uci);
  } catch {
    return false;
  }
}

/**
 * Runs searches on the best available backend — native Stockfish, then Stockfish
 * WASM, then the built-in minimax — and fails over automatically when a backend
 * cannot start, errors, times out or returns an illegal move.
 */
export class AiEngine {
  private order: EngineBackend[] | null;
  private index = 0;
  private current: Backend | null = null;
  private ready: Promise<Backend> | null = null;
  private listeners = new Set<Listener>();

  constructor(
    order?: EngineBackend[],
    private readonly factory: (id: EngineBackend) => Backend = createBackend,
  ) {
    this.order = order ?? null;
  }

  get backend(): EngineBackend | null {
    return this.current?.id ?? null;
  }

  onBackendChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Start the best backend that works (idempotent). */
  warmUp(): Promise<Backend> {
    this.ready ??= this.connect().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async connect(): Promise<Backend> {
    if (!this.order) {
      try {
        const status = await window.chessArena.engine.start();
        this.order = ['native', ...status.fallbacks];
      } catch {
        this.order = ['wasm', 'minimax'];
      }
    }
    let reason: string | undefined;
    const previous = this.current?.id ?? null;
    while (this.index < this.order.length) {
      const backend = this.factory(this.order[this.index]!);
      try {
        await backend.init();
        this.current = backend;
        if (backend.id !== previous) {
          for (const cb of this.listeners) cb(backend.id, previous, reason);
        }
        return backend;
      } catch (err) {
        backend.dispose();
        reason = err instanceof Error ? err.message : String(err);
        console.warn(`[engine] ${backend.id} unavailable: ${reason}`);
        this.index++;
      }
    }
    throw new Error('No chess engine available');
  }

  private failover(backend: Backend, reason: string): void {
    if (this.current !== backend) return;
    console.warn(`[engine] ${backend.id} failed: ${reason}`);
    backend.dispose();
    this.index++;
    this.ready = null;
    // Keep `current` so listeners learn which backend we moved away from.
  }

  /** Search, failing over as needed. Rejects with `AbortError` when `signal` fires. */
  async search(req: AiSearch, signal?: AbortSignal): Promise<EngineResult> {
    for (;;) {
      if (signal?.aborted) throw new AbortError();
      const backend = await this.warmUp();
      if (signal?.aborted) throw new AbortError();
      let result: SearchResult;
      try {
        result = await raceAbort(backend.search(req), signal, () => backend.stop());
      } catch (err) {
        if (err instanceof AbortError) throw err;
        this.failover(backend, err instanceof Error ? err.message : String(err));
        continue;
      }
      if (!isLegalUci(req.fen, req.moves, result.bestmove)) {
        this.failover(backend, `illegal move ${result.bestmove}`);
        continue;
      }
      return { ...result, backend: backend.id };
    }
  }

  stop(): void {
    this.current?.stop();
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void) {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new AbortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', abort);
        reject(e);
      },
    );
  });
}

/** The app-wide engine. */
export const aiEngine = new AiEngine();
