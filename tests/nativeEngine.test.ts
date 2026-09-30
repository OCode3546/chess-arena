import { Chess } from 'chess.js';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NativeEngine } from '../electron/engine';
import { EngineTimeoutError } from '@shared/uci';
import { hostEngineBinary } from './engineBinary';

const START = new Chess().fen();

const binary = hostEngineBinary();
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidOf = (e: NativeEngine) =>
  (e as unknown as { proc: { pid: number } | null }).proc?.pid ?? null;

describe('native engine: missing binary', () => {
  it('reports unavailable instead of throwing', async () => {
    const engine = new NativeEngine(join(tmpdir(), 'no-such-stockfish.exe'));
    expect(await engine.start()).toMatchObject({ ok: false });
    await expect(engine.search({ fen: START, moves: [], skill: 0, depth: 1 })).rejects.toThrow();
  });
});

describe.skipIf(!existsSync(binary))('native Stockfish', () => {
  const engine = new NativeEngine(binary);
  afterAll(() => engine.dispose());

  it('starts and answers with a legal move', async () => {
    const status = await engine.start();
    expect(status.ok).toBe(true);
    expect(status.name).toMatch(/Stockfish/);
    const res = await engine.search({ fen: START, moves: ['e2e4'], skill: 20, depth: 8 });
    const chess = new Chess();
    chess.move('e4');
    expect(chess.moves({ verbose: true }).map((m) => m.lan)).toContain(res.bestmove);
    expect(typeof res.score).toBe('number');
  });

  it('stops a long search on request', async () => {
    const t0 = Date.now();
    const p = engine.search({ fen: START, moves: [], skill: 20, movetime: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    engine.stop();
    await p;
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('restarts after the process dies', async () => {
    const pid = pidOf(engine)!;
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    const res = await engine.search({ fen: START, moves: [], skill: 5, depth: 3 });
    expect(res.bestmove).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(pidOf(engine)).not.toBe(pid);
  });

  it('leaves no process behind after dispose', async () => {
    const other = new NativeEngine(binary);
    await other.start();
    const pid = pidOf(other)!;
    expect(alive(pid)).toBe(true);
    other.dispose();
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('native engine: hung process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-arena-fake-engine-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('times out, kills the process and reports failure', async () => {
    const script = join(dir, 'hung-engine');
    // Answers the handshake, then ignores `go` and `stop`.
    writeFileSync(
      script,
      `#!/usr/bin/env node
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  if (l === 'uci') console.log('id name Hung\\nuciok');
  if (l === 'isready') console.log('readyok');
});
`,
    );
    chmodSync(script, 0o755);
    const engine = new NativeEngine(script);
    expect((await engine.start()).ok).toBe(true);
    const pid = pidOf(engine)!;
    await expect(
      engine.search({ fen: START, moves: [], skill: 1, movetime: 10 }),
    ).rejects.toBeInstanceOf(EngineTimeoutError);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(false);
    engine.dispose();
  }, 15_000);
});
