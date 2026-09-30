import type { PieceSymbol } from 'chess.js';

export interface Avatar {
  id: string;
  name: string;
  piece: PieceSymbol;
  from: string;
  to: string;
}

/** Starter avatars (level 1). Packs unlock with progression later. */
export const AVATARS: Avatar[] = [
  { id: 'knight-indigo', name: 'Indigo Knight', piece: 'n', from: '#6366f1', to: '#a855f7' },
  { id: 'rook-emerald', name: 'Emerald Rook', piece: 'r', from: '#059669', to: '#22d3ee' },
  { id: 'bishop-amber', name: 'Amber Bishop', piece: 'b', from: '#d97706', to: '#f43f5e' },
  { id: 'queen-rose', name: 'Rose Queen', piece: 'q', from: '#e11d48', to: '#8b5cf6' },
];

export const avatarById = (id: string): Avatar => AVATARS.find((a) => a.id === id) ?? AVATARS[0]!;
