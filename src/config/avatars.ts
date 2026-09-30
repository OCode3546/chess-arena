import type { PieceSymbol } from 'chess.js';

export type AvatarPack = 'starter' | 'pack-1' | 'pack-2' | 'legendary';

export interface Avatar {
  id: string;
  name: string;
  piece: PieceSymbol;
  from: string;
  to: string;
  /** Which reward unlocks it (levels live in `rewards.ts`). */
  pack: AvatarPack;
  /** Animated rainbow background. */
  legendary?: boolean;
}

const avatar = (
  id: string,
  name: string,
  piece: PieceSymbol,
  from: string,
  to: string,
  pack: AvatarPack,
): Avatar => ({ id, name, piece, from, to, pack });

export const AVATARS: Avatar[] = [
  avatar('knight-indigo', 'Indigo Knight', 'n', '#6366f1', '#a855f7', 'starter'),
  avatar('rook-emerald', 'Emerald Rook', 'r', '#059669', '#22d3ee', 'starter'),
  avatar('bishop-amber', 'Amber Bishop', 'b', '#d97706', '#f43f5e', 'starter'),
  avatar('queen-rose', 'Rose Queen', 'q', '#e11d48', '#8b5cf6', 'starter'),
  avatar('pawn-sky', 'Sky Pawn', 'p', '#0ea5e9', '#6366f1', 'pack-1'),
  avatar('knight-lime', 'Lime Knight', 'n', '#65a30d', '#14b8a6', 'pack-1'),
  avatar('rook-coral', 'Coral Rook', 'r', '#f97316', '#ec4899', 'pack-1'),
  avatar('bishop-violet', 'Violet Bishop', 'b', '#7c3aed', '#2563eb', 'pack-1'),
  avatar('king-crimson', 'Crimson King', 'k', '#b91c1c', '#f59e0b', 'pack-2'),
  avatar('queen-aurora', 'Aurora Queen', 'q', '#06b6d4', '#a855f7', 'pack-2'),
  avatar('knight-obsidian', 'Obsidian Knight', 'n', '#111827', '#6b7280', 'pack-2'),
  avatar('pawn-gold', 'Golden Pawn', 'p', '#a16207', '#facc15', 'pack-2'),
  {
    ...avatar('king-legend', 'Legendary King', 'k', '#f43f5e', '#6366f1', 'legendary'),
    legendary: true,
  },
];

export const avatarById = (id: string): Avatar => AVATARS.find((a) => a.id === id) ?? AVATARS[0]!;
