import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { capturedPieces, trackPieces } from '@/game/pieceIds';
import { START_FEN } from '@/game/rules';

function replay(fen: string, moves: (string | { from: string; to: string; promotion?: string })[]) {
  const c = new Chess(fen);
  moves.forEach((m) => c.move(m));
  return { chess: c, history: c.history({ verbose: true }) };
}

function boardFromTracked(fen: string, history: ReturnType<typeof replay>['history']) {
  return Object.fromEntries(
    trackPieces(fen, history).map((p) => [p.square, `${p.color}${p.type}`]),
  );
}

function boardFromChess(c: Chess) {
  const out: Record<string, string> = {};
  for (const row of c.board()) for (const p of row) if (p) out[p.square] = `${p.color}${p.type}`;
  return out;
}

describe('trackPieces', () => {
  it('keeps ids stable and matches the real board through a full game with special moves', () => {
    const { chess, history } = replay(START_FEN, [
      'e4',
      'd5',
      'e5',
      'f5',
      'exf6',
      'Nc6',
      'fxg7',
      'Be6',
      'gxh8=Q',
      'Qd6',
      'Nf3',
      'O-O-O',
      'Bc4',
      'a6',
      'O-O',
    ]);
    expect(boardFromTracked(START_FEN, history)).toEqual(boardFromChess(chess));
    const pieces = trackPieces(START_FEN, history);
    expect(new Set(pieces.map((p) => p.id)).size).toBe(pieces.length);
    // The promoted queen keeps the e-pawn's id.
    expect(pieces.find((p) => p.square === 'h8')).toMatchObject({ id: 'wp-e2', type: 'q' });
    // Castled rooks keep their ids.
    expect(pieces.find((p) => p.square === 'f1')?.id).toBe('wr-h1');
    expect(pieces.find((p) => p.square === 'd8')?.id).toBe('br-a8');
  });

  it('lists captured pieces per capturing side', () => {
    const { history } = replay(START_FEN, ['e4', 'd5', 'exd5', 'Qxd5']);
    expect(capturedPieces(history)).toEqual({ w: ['p'], b: ['p'] });
  });
});
