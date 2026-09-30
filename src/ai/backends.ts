import stockfishJsUrl from 'stockfish/bin/stockfish-19-lite-single.js?url';
import stockfishWasmUrl from 'stockfish/bin/stockfish-19-lite-single.wasm?url';
import type { EngineBackend } from '@shared/types';
import { EngineTimeoutError, UciSession, type SearchRequest, type SearchResult } from '@shared/uci';
import { minimaxSearch } from './minimax';
import type { MinimaxJob } from './minimax.worker';
import MinimaxWorker from './minimax.worker?worker';

/** A search as the AI layer issues it: UCI limits plus the fallback's depth. */
export interface AiSearch extends SearchRequest {
  minimaxDepth: number;
  /** Random root jitter for the minimax fallback (centipawns). */
  jitter?: number;
}

export interface Backend {
  readonly id: EngineBackend;
  /** Resolves when ready; rejects if this backend cannot be used. */
  init(): Promise<void>;
  search(req: AiSearch): Promise<SearchResult>;
  /** Cancel the current search (best effort; its result is ignored). */
  stop(): void;
  dispose(): void;
}

const uciPart = (req: AiSearch): SearchRequest => ({
  fen: req.fen,
  moves: req.moves,
  skill: req.skill,
  ...(req.depth !== undefined && { depth: req.depth }),
  ...(req.movetime !== undefined && { movetime: req.movetime }),
});

const deadline = (req: SearchRequest) => (req.movetime ?? 0) + 8_000;

/** Native Stockfish in the main process, over IPC. */
export class NativeBackend implements Backend {
  readonly id = 'native';
  name = 'Stockfish';

  async init(): Promise<void> {
    const status = await window.chessArena.engine.start();
    if (!status.native) throw new Error(status.error ?? 'Native engine unavailable');
    this.name = status.name ?? this.name;
  }

  search(req: AiSearch): Promise<SearchResult> {
    return withTimeout(window.chessArena.engine.bestMove(uciPart(req)), deadline(req) + 7_000);
  }

  stop(): void {
    window.chessArena.engine.stop();
  }

  dispose(): void {
    this.stop();
  }
}

/** Stockfish compiled to WebAssembly (lite network, single thread) in a Web Worker. */
export class WasmBackend implements Backend {
  readonly id = 'wasm';
  private worker: Worker | null = null;
  private session: UciSession | null = null;

  async init(): Promise<void> {
    const wasm = new URL(stockfishWasmUrl, location.href).href;
    const worker = new Worker(`${stockfishJsUrl}#${encodeURIComponent(wasm)}`);
    const session = new UciSession((cmd) => worker.postMessage(cmd), { Hash: 32 });
    worker.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') session.handleLine(e.data);
    };
    worker.onerror = (e) => session.fail(new Error(e.message || 'WASM engine crashed'));
    this.worker = worker;
    this.session = session;
    try {
      await session.init(20_000);
    } catch (err) {
      this.dispose();
      throw err;
    }
  }

  async search(req: AiSearch): Promise<SearchResult> {
    if (!this.session) throw new Error('WASM engine not started');
    try {
      return await this.session.search(uciPart(req), deadline(req));
    } catch (err) {
      if (err instanceof EngineTimeoutError) this.dispose();
      throw err;
    }
  }

  stop(): void {
    this.session?.stop();
  }

  dispose(): void {
    this.session?.fail(new Error('WASM engine stopped'));
    this.worker?.terminate();
    this.worker = null;
    this.session = null;
  }
}

/** Built-in minimax in its own worker; runs inline (briefly blocking) if workers fail. */
export class MinimaxBackend implements Backend {
  readonly id = 'minimax';
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (r: SearchResult) => void;
    reject: (e: Error) => void;
  } | null = null;
  private inline = false;

  async init(): Promise<void> {
    try {
      this.spawn();
    } catch {
      this.inline = true;
    }
  }

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const worker = new MinimaxWorker();
    worker.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; result?: SearchResult; error?: string }>,
    ) => {
      const p = this.pending;
      if (!p || p.id !== e.data.id) return;
      this.pending = null;
      if (e.data.ok && e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'Minimax failed'));
    };
    worker.onerror = () => {
      this.inline = true;
      this.terminate(new Error('Minimax worker crashed'));
    };
    this.worker = worker;
    return worker;
  }

  private terminate(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    const p = this.pending;
    this.pending = null;
    p?.reject(reason);
  }

  search(req: AiSearch): Promise<SearchResult> {
    const options = {
      depth: req.minimaxDepth,
      timeLimitMs: Math.min(req.movetime ?? 3_000, 3_000),
      jitter: req.jitter,
    };
    if (this.inline) {
      // Last resort: keep the game going even without workers.
      return Promise.resolve(minimaxSearch(req.fen, req.moves, { ...options, timeLimitMs: 800 }));
    }
    this.terminate(new Error('Superseded'));
    return new Promise<SearchResult>((resolve, reject) => {
      const job: MinimaxJob = { id: this.nextId++, fen: req.fen, moves: req.moves, options };
      this.pending = { id: job.id, resolve, reject };
      try {
        this.spawn().postMessage(job);
      } catch (err) {
        this.pending = null;
        this.inline = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  stop(): void {
    this.terminate(new Error('Stopped'));
  }

  dispose(): void {
    this.stop();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EngineTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createBackend(id: EngineBackend): Backend {
  if (id === 'native') return new NativeBackend();
  if (id === 'wasm') return new WasmBackend();
  return new MinimaxBackend();
}
