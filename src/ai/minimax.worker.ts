import { minimaxSearch, type MinimaxOptions } from './minimax';

export interface MinimaxJob {
  id: number;
  fen: string;
  moves: string[];
  options: Pick<MinimaxOptions, 'depth' | 'timeLimitMs' | 'jitter'>;
}

self.onmessage = (e: MessageEvent<MinimaxJob>) => {
  const { id, fen, moves, options } = e.data;
  try {
    postMessage({ id, ok: true, result: minimaxSearch(fen, moves, options) });
  } catch (err) {
    postMessage({ id, ok: false, error: String(err) });
  }
};
