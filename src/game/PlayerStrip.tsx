import type { PieceSymbol } from 'chess.js';
import { useMemo } from 'react';
import type { Color } from '@shared/types';
import { pieceUrl } from '@/config/pieces';
import { useAiUi } from '@/ai/useAiOpponent';
import { Avatar, LevelBadge } from '@/components/Avatar';
import { XpBar } from '@/components/XpBar';
import { aiColorOf, useGameStore } from '@/store/gameStore';
import { useProfile } from '@/store/profileStore';
import { useSettings } from '@/store/settingsStore';
import { cx, formatClock } from '@/utils/format';
import { capturedPieces } from './pieceIds';
import { other, PIECE_VALUE } from './rules';

const ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];

function Clock({ color }: { color: Color }) {
  const ms = useGameStore((s) => s.clocks[color]);
  const timed = useGameStore((s) => (s.settings?.timeControl.initialMs ?? 0) > 0);
  const running = useGameStore(
    (s) => s.status === 'playing' && !s.paused && s.clockStarted && s.fen.split(' ')[1] === color,
  );
  if (!timed) return null;
  const low = ms < 20_000;
  return (
    <div
      role="timer"
      aria-label={`${color === 'w' ? 'White' : 'Black'} clock`}
      className={cx(
        'rounded-xl px-3 py-1.5 font-mono text-2xl font-bold tabular-nums transition-colors',
        running
          ? low
            ? 'low-time bg-danger text-white'
            : 'bg-accent text-white'
          : 'bg-surface-2 text-muted',
        !running && low && 'text-danger',
      )}
    >
      {formatClock(ms)}
    </div>
  );
}

export function PlayerStrip({ color, compact }: { color: Color; compact?: boolean }) {
  const name = useGameStore((s) => s.settings?.players[color].name ?? '');
  const profile = useProfile(useGameStore((s) => s.settings?.players[color].profileId));
  const history = useGameStore((s) => s.history);
  const viewPly = useGameStore((s) => s.viewPly);
  const toMove = useGameStore((s) => s.status === 'playing' && s.fen.split(' ')[1] === color);
  const pieceSet = useSettings((s) => s.settings.pieceSet);
  const isAi = useGameStore((s) => aiColorOf(s.settings) === color);
  const thinking = useAiUi((s) => s.thinking) && isAi && toMove;

  const shown = viewPly === null ? history : history.slice(0, viewPly);
  const { taken, advantage } = useMemo(() => {
    const cap = capturedPieces(shown);
    const score = (list: PieceSymbol[]) => list.reduce((sum, p) => sum + PIECE_VALUE[p], 0);
    // Promotions change material too, so derive the advantage from captures plus promotions.
    const promo = (c: Color) =>
      shown
        .filter((m) => m.color === c && m.promotion)
        .reduce((s, m) => s + PIECE_VALUE[m.promotion!] - 1, 0);
    const mine = score(cap[color]) + promo(color);
    const theirs = score(cap[other(color)]) + promo(other(color));
    const sorted = [...cap[color]].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return { taken: sorted, advantage: mine - theirs };
  }, [shown, color]);

  return (
    <div
      className={cx(
        'glass flex flex-col gap-3 rounded-2xl p-4',
        toMove && 'ring-2 ring-accent-soft/60',
      )}
    >
      <div className="flex items-center gap-3">
        {profile ? (
          <Avatar id={profile.avatarId} size={44} className="rounded-xl" />
        ) : (
          <div
            className={cx(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-line',
              color === 'w' ? 'bg-[#f3f4f8]' : 'bg-[#1d2030]',
            )}
          >
            <img
              src={pieceUrl(pieceSet, color, 'k')}
              alt=""
              className="h-8 w-8"
              draggable={false}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            {profile && <LevelBadge level={profile.level} className="h-5 px-2 text-[11px]" />}
          </div>
          <div className="text-xs text-muted" aria-live={isAi ? 'polite' : undefined}>
            {color === 'w' ? 'White' : 'Black'}
            {isAi && ' · Computer'}
            {thinking ? (
              <span className="thinking ml-1 text-accent-soft">· thinking</span>
            ) : (
              toMove && ' · to move'
            )}
          </div>
        </div>
        {!compact && <Clock color={color} />}
      </div>
      {profile && <XpBar xp={profile.xp} size="sm" showLabel={false} />}
      <div
        className="flex min-h-6 items-center gap-0.5"
        aria-label={`Pieces captured by ${color === 'w' ? 'White' : 'Black'}`}
      >
        {taken.map((p, i) => (
          <img
            key={i}
            src={pieceUrl(pieceSet, other(color), p)}
            alt={p}
            className={cx('h-5 w-5', i > 0 && taken[i - 1] === p && '-ml-2.5')}
            draggable={false}
          />
        ))}
        {advantage > 0 && (
          <span className="ml-1.5 text-xs font-semibold text-muted">+{advantage}</span>
        )}
      </div>
      {compact && <Clock color={color} />}
    </div>
  );
}
