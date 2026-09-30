/**
 * Transport-independent UCI client used for the native Stockfish child process
 * (main process) and the Stockfish WASM worker (renderer).
 */

export interface SearchRequest {
  /** Starting position of the game. */
  fen: string;
  /** Moves played since `fen`, in UCI notation (keeps repetition history for the engine). */
  moves: string[];
  /** Stockfish "Skill Level" 0–20. */
  skill: number;
  depth?: number;
  movetime?: number;
}

export interface SearchResult {
  /** Best move in UCI notation, e.g. `e2e4` or `e7e8q`. */
  bestmove: string;
  /** Evaluation in centipawns from the side to move; mates map to ±(MATE_SCORE − plies). */
  score: number | null;
}

export const MATE_SCORE = 100_000;

export const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class EngineTimeoutError extends Error {
  constructor(message = 'Engine did not answer in time') {
    super(message);
    this.name = 'EngineTimeoutError';
  }
}

/** Score from a UCI `info` line (principal variation only), or undefined if absent. */
export function parseInfoScore(line: string): number | undefined {
  if (!line.startsWith('info ')) return undefined;
  const multipv = /\bmultipv (\d+)/.exec(line);
  if (multipv && multipv[1] !== '1') return undefined;
  if (/\b(lowerbound|upperbound)\b/.test(line)) return undefined;
  const m = /\bscore (cp|mate) (-?\d+)/.exec(line);
  if (!m) return undefined;
  const n = Number(m[2]);
  if (m[1] === 'cp') return n;
  // "mate 0" means the side to move is already mated.
  if (n <= 0) return -MATE_SCORE - n;
  return MATE_SCORE - n;
}

/** The move from a `bestmove` line, `null` for `(none)`, undefined if not a bestmove line. */
export function parseBestmove(line: string): string | null | undefined {
  const m = /^bestmove (\S+)/.exec(line);
  if (!m) return undefined;
  return UCI_MOVE.test(m[1]!) ? m[1]! : null;
}

export function goCommand(req: Pick<SearchRequest, 'depth' | 'movetime'>): string {
  const parts = ['go'];
  if (req.depth !== undefined) parts.push('depth', String(req.depth));
  if (req.movetime !== undefined) parts.push('movetime', String(req.movetime));
  if (parts.length === 1) parts.push('depth', '10');
  return parts.join(' ');
}

export function positionCommand(req: Pick<SearchRequest, 'fen' | 'moves'>): string {
  const base = `position fen ${req.fen}`;
  return req.moves.length ? `${base} moves ${req.moves.join(' ')}` : base;
}

type Waiter = { match: (line: string) => boolean; resolve: (line: string) => void };

/** Time to wait for `bestmove` after sending `stop` before declaring the engine hung. */
const STOP_GRACE_MS = 1500;

/**
 * Speaks UCI over any line-based transport. Searches are serialized: a new
 * request waits for the previous `bestmove` (callers `stop()` first to cancel).
 */
export class UciSession {
  private waiters: Waiter[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private skill: number | null = null;
  private searching = false;
  private dead: Error | null = null;
  name = 'Stockfish';

  constructor(
    private readonly send: (command: string) => void,
    private readonly options: Record<string, string | number> = {},
  ) {}

  /** Feed one line of engine output. */
  handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    for (const w of [...this.waiters]) {
      if (w.match(line)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  }

  /** Mark the transport as gone; pending and future calls reject. */
  fail(err: Error): void {
    this.dead = err;
    for (const w of this.waiters.splice(0)) w.resolve(`__dead__`);
  }

  get isSearching(): boolean {
    return this.searching;
  }

  private waitFor(match: (line: string) => boolean, timeoutMs: number): Promise<string> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (line) => {
          clearTimeout(timer);
          if (line === '__dead__') reject(this.dead ?? new Error('Engine exited'));
          else resolve(line);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new EngineTimeoutError());
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private sendChecked(command: string): void {
    if (this.dead) throw this.dead;
    this.send(command);
  }

  /** `uci` handshake, engine options and `isready`. */
  async init(timeoutMs = 10_000): Promise<void> {
    void this.waitFor((l) => l.startsWith('id name '), timeoutMs).then(
      (l) => (this.name = l.slice(8).trim()),
      () => undefined,
    );
    const uciok = this.waitFor((l) => l === 'uciok', timeoutMs);
    this.sendChecked('uci');
    await uciok;
    for (const [name, value] of Object.entries(this.options)) {
      this.sendChecked(`setoption name ${name} value ${value}`);
    }
    await this.ready(timeoutMs);
  }

  async ready(timeoutMs = 10_000): Promise<void> {
    const ok = this.waitFor((l) => l === 'readyok', timeoutMs);
    this.sendChecked('isready');
    await ok;
  }

  /** Run one search. Rejects with `EngineTimeoutError` if the engine stops answering. */
  search(req: SearchRequest, timeoutMs: number): Promise<SearchResult> {
    const run = async (): Promise<SearchResult> => {
      if (this.skill !== req.skill) {
        this.sendChecked(`setoption name Skill Level value ${req.skill}`);
        this.skill = req.skill;
      }
      this.sendChecked(positionCommand(req));
      await this.ready(Math.min(timeoutMs, 10_000));

      let score: number | null = null;
      const infoWaiter: Waiter = {
        match: (l) => {
          const s = parseInfoScore(l);
          if (s !== undefined) score = s;
          return false;
        },
        resolve: () => undefined,
      };
      this.waiters.push(infoWaiter);
      this.searching = true;
      try {
        const best = this.waitFor((l) => l.startsWith('bestmove'), timeoutMs);
        this.sendChecked(goCommand(req));
        let line: string;
        try {
          line = await best;
        } catch (err) {
          if (!(err instanceof EngineTimeoutError)) throw err;
          const late = this.waitFor((l) => l.startsWith('bestmove'), STOP_GRACE_MS);
          this.sendChecked('stop');
          line = await late;
        }
        const move = parseBestmove(line);
        if (!move) throw new Error(`Engine returned no move (${line})`);
        return { bestmove: move, score };
      } finally {
        this.searching = false;
        const i = this.waiters.indexOf(infoWaiter);
        if (i >= 0) this.waiters.splice(i, 1);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Ask a running search to finish now (its promise still resolves with a move). */
  stop(): void {
    if (this.searching && !this.dead) this.send('stop');
  }
}
