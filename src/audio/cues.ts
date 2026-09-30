import type { Color } from '@shared/types';
import type { GameResult } from '@/game/rules';

export type SoundId =
  'move' | 'capture' | 'check' | 'castle' | 'promote' | 'win' | 'lose' | 'draw' | 'levelUp';

/** The sound for a move. Mate plays the plain move sound: the game-over sound follows it. */
export function moveSound(m: {
  san: string;
  flags: string;
  captured?: string;
  promotion?: string;
}): SoundId {
  if (m.san.endsWith('+')) return 'check';
  if (m.promotion) return 'promote';
  if (m.flags.includes('k') || m.flags.includes('q')) return 'castle';
  if (m.captured) return 'capture';
  return 'move';
}

/** Game-over sound: vs the computer from the human's side; a local game just won or drawn. */
export function endSound(result: GameResult, humanColor: Color | null): SoundId {
  if (!result.winner) return 'draw';
  return humanColor && result.winner !== humanColor ? 'lose' : 'win';
}
