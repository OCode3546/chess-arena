import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { EngineTimeoutError, UciSession, type SearchRequest, type SearchResult } from '@shared/uci';

export interface NativeEngineStatus {
  ok: boolean;
  name?: string;
  error?: string;
}

/** Keep the engine light so the app stays responsive on low-end PCs. */
const ENGINE_OPTIONS = { Threads: 1, Hash: 64 };
/** Give up on the native engine after this many failed starts or crashes. */
const MAX_STARTS = 3;

/** Search deadline: the requested time plus headroom, or a generous cap for depth searches. */
export function searchTimeout(req: SearchRequest): number {
  return req.movetime !== undefined ? req.movetime + 5_000 : 20_000;
}

/**
 * Owns the Stockfish child process: spawn + UCI handshake, serialized searches with
 * timeouts, automatic restart after a crash or hang, and kill on dispose.
 * Stockfish also exits by itself when its stdin closes, so it cannot outlive the app.
 */
export class NativeEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private session: UciSession | null = null;
  private starting: Promise<NativeEngineStatus> | null = null;
  private starts = 0;
  private lastError: string | undefined;
  private disposed = false;

  constructor(private readonly binaryPath: string | null) {}

  get running(): boolean {
    return !!this.proc && !!this.session;
  }

  start(): Promise<NativeEngineStatus> {
    if (this.running) return Promise.resolve({ ok: true, name: this.session!.name });
    this.starting ??= this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  private async launch(): Promise<NativeEngineStatus> {
    if (this.disposed) return { ok: false, error: 'Engine disposed' };
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      this.lastError = 'Engine binary not found';
      return { ok: false, error: this.lastError };
    }
    if (this.starts >= MAX_STARTS) return { ok: false, error: this.lastError ?? 'Engine failed' };
    this.starts++;

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(this.binaryPath, [], { windowsHide: true, stdio: 'pipe' });
    } catch (err) {
      this.lastError = String(err);
      return { ok: false, error: this.lastError };
    }
    const session = new UciSession((cmd) => {
      if (proc.stdin.writable) proc.stdin.write(`${cmd}\n`);
    }, ENGINE_OPTIONS);
    this.proc = proc;
    this.session = session;

    const onGone = (err: Error) => {
      this.lastError = err.message;
      session.fail(err);
      if (this.proc === proc) {
        this.proc = null;
        this.session = null;
      }
    };
    proc.on('error', onGone);
    proc.on('exit', (code, signal) => onGone(new Error(`Engine exited (${signal ?? code})`)));
    proc.stdin.on('error', () => undefined);
    createInterface({ input: proc.stdout }).on('line', (line) => session.handleLine(line));

    try {
      await session.init();
      return { ok: true, name: session.name };
    } catch (err) {
      this.kill();
      this.lastError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: this.lastError };
    }
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const status = await this.start();
    if (!status.ok || !this.session) throw new Error(status.error ?? 'Engine unavailable');
    const session = this.session;
    try {
      return await session.search(req, searchTimeout(req));
    } catch (err) {
      // A hung engine is killed; the next search starts a fresh process.
      if (err instanceof EngineTimeoutError && this.session === session) this.kill();
      throw err;
    }
  }

  stop(): void {
    this.session?.stop();
  }

  private kill(): void {
    const proc = this.proc;
    this.proc = null;
    this.session?.fail(new Error('Engine stopped'));
    this.session = null;
    if (proc && proc.exitCode === null) {
      proc.stdin.end();
      proc.kill();
    }
  }

  /** Quit the engine for good (app shutdown). */
  dispose(): void {
    this.disposed = true;
    const proc = this.proc;
    if (proc?.stdin.writable) proc.stdin.write('quit\n');
    this.kill();
  }
}
