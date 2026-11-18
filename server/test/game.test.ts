import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { makeGame } from './helpers';

const SCHOLARS_MATE = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

describe('Game: results decided on the board', () => {
  it('checkmate', () => {
    const { game, play, last, ended } = makeGame();
    play(SCHOLARS_MATE);
    expect(game.outcome).toEqual({ result: '1-0', winner: 'w', reason: 'checkmate' });
    expect(last('b', 'game.over')).toMatchObject({ result: '1-0', reason: 'checkmate', plies: 7 });
    expect(ended).toHaveLength(1);
  });

  it('stalemate', () => {
    const { game, play } = makeGame({ fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1' });
    play(['f1f7']);
    expect(game.outcome).toMatchObject({ result: '1/2-1/2', reason: 'stalemate' });
  });

  it('threefold repetition is claimed automatically', () => {
    const { game, play } = makeGame();
    play(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
    expect(game.outcome).toMatchObject({ result: '1/2-1/2', reason: 'threefold' });
  });

  it('fifty-move rule', () => {
    const { game, play } = makeGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 99 60' });
    play(['a1a2']);
    expect(game.outcome).toMatchObject({ reason: 'fifty-move' });
  });

  it('insufficient material', () => {
    const { game, play } = makeGame({ fen: '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1' });
    play(['e1d2']);
    expect(game.outcome).toMatchObject({ reason: 'insufficient' });
  });

  it('castling, en passant and promotion are recorded in UCI', () => {
    const { game, play, last } = makeGame();
    const moves = ['e2e4', 'g8f6', 'e4e5', 'd7d5', 'e5d6', 'e7e6', 'g1f3', 'b8c6', 'f1e2', 'c8d7'];
    play([...moves, 'e1g1', 'a7a6', 'd6c7', 'a6a5', 'c7d8q']);
    const state = last('w', 'game.state')!;
    expect(state.moves.slice(-5)).toEqual(['e1g1', 'a7a6', 'd6c7', 'a6a5', 'c7d8q']);
    expect(state.fen.startsWith('r2Qkb1r/')).toBe(true);
    expect(game.over).toBe(false);
  });

  it('writes a complete PGN', () => {
    const { game, play } = makeGame();
    play(SCHOLARS_MATE);
    expect(game.pgn).toContain('[White "Wendy"]');
    expect(game.pgn).toContain('[Result "1-0"]');
    expect(game.pgn).toContain('[TimeControl "60+2"]');
    const replay = new Chess();
    replay.loadPgn(game.pgn);
    expect(replay.isCheckmate()).toBe(true);
  });
});

describe('Game: move validation', () => {
  it('rejects moves out of turn, illegal moves and moves after the end', () => {
    const { game, sent, last } = makeGame();
    game.move('b', 'e7e5', 0);
    expect(last('b', 'error')).toMatchObject({ code: 'NOT_YOUR_TURN' });
    game.move('w', 'e2e5', 0);
    expect(last('w', 'error')).toMatchObject({ code: 'ILLEGAL' });
    expect(game.plies).toBe(0);
    game.resign('w');
    sent.w.length = 0;
    game.move('w', 'e2e4', 0);
    expect(last('w', 'error')).toMatchObject({ code: 'GAME_OVER' });
  });

  it('requires a promotion piece and ignores a stray one', () => {
    const { game, last } = makeGame({ fen: '4k3/2P5/8/8/8/8/8/4K3 w - - 0 1' });
    game.move('w', 'c7c8', 0);
    expect(last('w', 'error')).toMatchObject({ code: 'ILLEGAL' });
    game.move('w', 'c7c8n', 0);
    expect(last('w', 'game.state')!.moves).toEqual(['c7c8n']);
    const plain = makeGame();
    plain.game.move('w', 'e2e4q', 0);
    expect(plain.last('w', 'game.state')!.moves).toEqual(['e2e4']);
  });

  it('treats a resent move as a no-op and a stale one as an error', () => {
    const { game, sent, last } = makeGame();
    game.move('w', 'e2e4', 0);
    game.move('b', 'e7e5', 1);
    sent.w.length = 0;
    game.move('w', 'e2e4', 0); // duplicate of ply 0
    expect(last('w', 'error')).toBeUndefined();
    expect(last('w', 'game.state')!.seq).toBe(2);
    game.move('w', 'g1f3', 1); // stale seq
    expect(last('w', 'error')).toMatchObject({ code: 'ILLEGAL' });
    expect(game.plies).toBe(2);
  });
});

describe('Game: clocks', () => {
  it('start after White moves, then deduct thinking time and add the increment', () => {
    const { game, timers, last } = makeGame();
    timers.advance(10_000);
    game.move('w', 'e2e4', 0); // clock starts, nothing deducted
    expect(last('w', 'game.state')).toMatchObject({
      clockRunning: true,
      clocks: { w: 60_000, b: 60_000 },
    });
    timers.advance(5_000);
    game.move('b', 'e7e5', 1);
    timers.advance(3_000);
    game.move('w', 'g1f3', 2);
    expect(last('w', 'game.state')!.clocks).toEqual({ w: 59_000, b: 57_000 });
  });

  it('credits measured lag, at most 500 ms per move', () => {
    const { game, timers, last } = makeGame({ lag: { w: 200, b: 2_000 } });
    game.move('w', 'e2e4', 0);
    timers.advance(5_000);
    game.move('b', 'e7e5', 1); // 5000 - 500 = 4500 used
    timers.advance(3_000);
    game.move('w', 'g1f3', 2); // 3000 - 200 = 2800 used
    expect(last('w', 'game.state')!.clocks).toEqual({ w: 59_200, b: 57_500 });
  });

  it('flags the side that runs out', () => {
    const { game, timers, play } = makeGame({ tc: { baseMs: 60_000, incMs: 0 } });
    play(['e2e4', 'e7e5']);
    timers.advance(59_999);
    expect(game.over).toBe(false);
    timers.advance(1);
    expect(game.outcome).toEqual({ result: '0-1', winner: 'b', reason: 'timeout' });
  });

  it('is a draw when the side with time left cannot mate', () => {
    const { game, timers, play } = makeGame({ fen: '4k3/8/8/8/8/8/8/4K2Q w - - 0 1' });
    play(['h1h2', 'e8d7']);
    timers.advance(61_000);
    expect(game.outcome).toMatchObject({ result: '1/2-1/2', reason: 'timeout-insufficient' });
  });

  it('aborts when a side never makes its first move', () => {
    const noMove = makeGame();
    noMove.timers.advance(30_000);
    expect(noMove.game.outcome).toMatchObject({ result: '*', reason: 'aborted' });
    const blackSilent = makeGame();
    blackSilent.play(['e2e4']);
    blackSilent.timers.advance(30_000);
    expect(blackSilent.game.outcome).toMatchObject({ reason: 'aborted' });
  });

  it('stops all timers when the game ends', () => {
    const { game, timers, play } = makeGame();
    play(['e2e4', 'e7e5']);
    game.resign('b');
    expect(timers.timerCount).toBe(0);
  });
});

describe('Game: resign, abort and draws', () => {
  it('resignation', () => {
    const { game } = makeGame();
    game.resign('b');
    expect(game.outcome).toEqual({ result: '1-0', winner: 'w', reason: 'resignation' });
  });

  it('abort only before both sides have moved', () => {
    const early = makeGame();
    early.play(['e2e4']);
    early.game.abort('b');
    expect(early.game.outcome).toMatchObject({ result: '*', reason: 'aborted' });
    const late = makeGame();
    late.play(['e2e4', 'e7e5']);
    late.game.abort('w');
    expect(late.game.over).toBe(false);
    expect(late.last('w', 'error')).toMatchObject({ code: 'ILLEGAL' });
  });

  it('draw by agreement', () => {
    const { game, play, last } = makeGame();
    play(['e2e4', 'e7e5']);
    game.offerDraw('w');
    expect(last('b', 'game.state')!.drawOfferFrom).toBe('w');
    game.acceptDraw('b');
    expect(game.outcome).toEqual({ result: '1/2-1/2', winner: null, reason: 'agreement' });
  });

  it('declining, or moving, turns the offer down', () => {
    const { game, play, last } = makeGame();
    play(['e2e4']);
    game.offerDraw('w');
    game.declineDraw('b');
    expect(last('w', 'game.state')!.drawOfferFrom).toBeNull();
    play(['e7e5']);
    game.offerDraw('b');
    play(['g1f3']); // White moves instead of answering
    expect(last('b', 'game.state')!.drawOfferFrom).toBeNull();
    game.acceptDraw('w');
    expect(game.over).toBe(false);
  });

  it('limits draw offers to one per player every 10 plies', () => {
    const { game, play, last } = makeGame();
    game.offerDraw('w');
    game.declineDraw('b');
    play(['e2e4', 'e7e5']);
    game.offerDraw('w');
    expect(last('w', 'error')).toMatchObject({ code: 'RATE_LIMIT' });
    play(['d2d3', 'd7d6', 'c2c3', 'c7c6', 'a2a3', 'a7a6', 'h2h3', 'h7h6']);
    game.offerDraw('w');
    expect(last('b', 'game.state')!.drawOfferFrom).toBe('w');
  });

  it('an offer while the opponent has one open is an acceptance', () => {
    const { game } = makeGame();
    game.offerDraw('w');
    game.offerDraw('b');
    expect(game.outcome).toMatchObject({ reason: 'agreement' });
  });
});

describe('Game: disconnects', () => {
  // Five minutes on the clock so the flag doesn't fall during the 60 s grace period.
  const LONG = { baseMs: 300_000, incMs: 0 };

  it('the opponent sees a countdown, and the absent player loses after the grace period', () => {
    const { game, timers, play, last } = makeGame({ tc: LONG });
    play(['e2e4', 'e7e5']);
    game.disconnect('w');
    expect(last('b', 'game.opponentStatus')).toMatchObject({ connected: false });
    expect(last('b', 'game.opponentStatus')!.graceEndsAt).toBe(timers.now() + 60_000);
    timers.advance(59_000);
    expect(game.over).toBe(false);
    timers.advance(1_000);
    expect(game.outcome).toEqual({ result: '0-1', winner: 'b', reason: 'abandonment' });
  });

  it('coming back in time cancels the countdown and resends the game', () => {
    const { game, timers, play, sent, last } = makeGame();
    play(['e2e4', 'e7e5']);
    game.disconnect('b');
    timers.advance(20_000);
    sent.b.length = 0;
    game.reconnect('b');
    expect(sent.b.map((m) => m.t)).toEqual(['game.start', 'game.state', 'game.opponentStatus']);
    expect(last('w', 'game.opponentStatus')).toMatchObject({ connected: true, graceEndsAt: null });
    timers.advance(60_000);
    expect(game.outcome?.reason).not.toBe('abandonment');
  });

  it('aborts if nobody comes back or the game had barely started', () => {
    const both = makeGame({ tc: LONG });
    both.play(['e2e4', 'e7e5']);
    both.game.disconnect('w');
    both.game.disconnect('b');
    both.timers.advance(60_000);
    expect(both.game.outcome).toMatchObject({ reason: 'aborted' });
    const early = makeGame();
    early.play(['e2e4']);
    early.game.disconnect('b');
    early.timers.advance(29_999);
    early.game.reconnect('b');
    early.game.disconnect('b');
    early.timers.advance(60_000);
    expect(early.game.outcome).toMatchObject({ reason: 'aborted' });
  });

  it('the clock keeps running while a player is away', () => {
    const { game, timers, play } = makeGame({ tc: { baseMs: 60_000, incMs: 0 } });
    play(['e2e4', 'e7e5']);
    game.disconnect('w');
    timers.advance(30_000);
    game.reconnect('w');
    expect(game.remaining('w')).toBe(30_000);
  });

  it('rejoining a finished game shows the result', () => {
    const { game, sent } = makeGame();
    game.resign('w');
    game.disconnect('b');
    sent.b.length = 0;
    game.reconnect('b');
    expect(sent.b.map((m) => m.t)).toContain('game.over');
  });
});
