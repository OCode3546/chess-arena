import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EngineTimeoutError,
  goCommand,
  MATE_SCORE,
  parseBestmove,
  parseInfoScore,
  positionCommand,
  UciSession,
} from '@shared/uci';
import { isSearchRequest } from '@shared/validate';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('UCI parsing', () => {
  it('reads centipawn and mate scores from the principal variation only', () => {
    expect(parseInfoScore('info depth 10 multipv 1 score cp 34 nodes 1 pv e2e4')).toBe(34);
    expect(parseInfoScore('info depth 10 multipv 2 score cp 90 pv d2d4')).toBeUndefined();
    expect(parseInfoScore('info depth 3 score mate 2 pv h5f7')).toBe(MATE_SCORE - 2);
    expect(parseInfoScore('info depth 3 score mate -1 pv a1a2')).toBe(-MATE_SCORE + 1);
    expect(parseInfoScore('info depth 0 score mate 0')).toBe(-MATE_SCORE);
    expect(parseInfoScore('info depth 9 score cp 20 lowerbound')).toBeUndefined();
    expect(parseInfoScore('info string NNUE enabled')).toBeUndefined();
  });

  it('reads bestmove lines', () => {
    expect(parseBestmove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestmove('bestmove a7a8q')).toBe('a7a8q');
    expect(parseBestmove('bestmove (none)')).toBeNull();
    expect(parseBestmove('info depth 1')).toBeUndefined();
  });

  it('builds position and go commands', () => {
    expect(positionCommand({ fen: START, moves: [] })).toBe(`position fen ${START}`);
    expect(positionCommand({ fen: START, moves: ['e2e4', 'e7e5'] })).toBe(
      `position fen ${START} moves e2e4 e7e5`,
    );
    expect(goCommand({ depth: 6 })).toBe('go depth 6');
    expect(goCommand({ depth: 6, movetime: 300 })).toBe('go depth 6 movetime 300');
    expect(goCommand({})).toBe('go depth 10');
  });
});

describe('engine request validation', () => {
  const ok = { fen: START, moves: ['e2e4'], skill: 5, depth: 3 };
  it('accepts well-formed requests', () => {
    expect(isSearchRequest(ok)).toBe(true);
    expect(isSearchRequest({ ...ok, movetime: 400 })).toBe(true);
  });
  it('rejects anything that could inject UCI commands or abuse the engine', () => {
    expect(isSearchRequest({ ...ok, fen: `${START}\nquit` })).toBe(false);
    expect(isSearchRequest({ ...ok, moves: ['e2e4 quit'] })).toBe(false);
    expect(isSearchRequest({ ...ok, skill: 21 })).toBe(false);
    expect(isSearchRequest({ ...ok, skill: 2.5 })).toBe(false);
    expect(isSearchRequest({ ...ok, depth: 99 })).toBe(false);
    expect(isSearchRequest({ ...ok, movetime: 60_000 })).toBe(false);
    expect(isSearchRequest(null)).toBe(false);
  });
});

/** Scripted fake engine: answers the handshake and replies to `go` via `onGo`. */
function fakeEngine(onGo: (cmd: string, reply: (line: string) => void) => void) {
  const sent: string[] = [];
  const reply = (line: string) => queueMicrotask(() => session.handleLine(line));
  const session: UciSession = new UciSession((cmd) => {
    sent.push(cmd);
    if (cmd === 'uci') {
      reply('id name FakeFish 1');
      reply('uciok');
    } else if (cmd === 'isready') reply('readyok');
    else if (cmd.startsWith('go')) onGo(cmd, reply);
    else if (cmd === 'stop') reply('bestmove d2d4');
  });
  return { session, sent };
}

describe('UciSession', () => {
  afterEach(() => vi.useRealTimers());

  it('handshakes, sets options and returns the best move with its score', async () => {
    const { session, sent } = fakeEngine((_cmd, reply) => {
      reply('info depth 1 multipv 1 score cp 12 pv e2e4');
      reply('info depth 2 multipv 1 score cp 25 pv e2e4');
      reply('bestmove e2e4 ponder e7e5');
    });
    await session.init();
    expect(session.name).toBe('FakeFish 1');
    const res = await session.search({ fen: START, moves: [], skill: 3, depth: 2 }, 1000);
    expect(res).toEqual({ bestmove: 'e2e4', score: 25 });
    expect(sent).toContain('setoption name Skill Level value 3');
    expect(sent).toContain('go depth 2');
  });

  it('serializes searches and only resends Skill Level when it changes', async () => {
    const { session, sent } = fakeEngine((_c, reply) => reply('bestmove g1f3'));
    await session.init();
    const req = { fen: START, moves: [], skill: 7, depth: 1 };
    const [a, b] = await Promise.all([session.search(req, 1000), session.search(req, 1000)]);
    expect(a.bestmove).toBe('g1f3');
    expect(b.bestmove).toBe('g1f3');
    expect(sent.filter((c) => c.startsWith('setoption name Skill')).length).toBe(1);
  });

  it('sends stop when a search overruns and uses the move it then reports', async () => {
    const { session, sent } = fakeEngine(() => undefined);
    await session.init();
    const res = await session.search({ fen: START, moves: [], skill: 20, movetime: 10 }, 50);
    expect(sent).toContain('stop');
    expect(res.bestmove).toBe('d2d4');
  });

  it('times out when the engine never answers', async () => {
    const session = new UciSession(() => undefined);
    await expect(session.init(30)).rejects.toBeInstanceOf(EngineTimeoutError);
  });

  it('rejects pending work when the transport dies', async () => {
    const { session } = fakeEngine(() => undefined);
    await session.init();
    const p = session.search({ fen: START, moves: [], skill: 1, depth: 1 }, 10_000);
    await Promise.resolve();
    session.fail(new Error('Engine exited (1)'));
    await expect(p).rejects.toThrow('Engine exited');
    await expect(
      session.search({ fen: START, moves: [], skill: 1, depth: 1 }, 100),
    ).rejects.toThrow('Engine exited');
  });
});
