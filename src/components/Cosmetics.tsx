import { boardTheme } from '@/config/boards';
import { pieceUrl } from '@/config/pieces';
import { cx } from '@/utils/format';

/** 2×2 corner of a board theme with a knight on it (optionally in a given piece set). */
export function BoardSwatch({
  id,
  pieceSet = 'modern',
  size = 56,
  className,
}: {
  id: string;
  pieceSet?: string;
  size?: number;
  className?: string;
}) {
  const t = boardTheme(id);
  return (
    <div
      className={cx(
        'relative grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-lg ring-1 ring-black/20',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div style={{ background: t.light }} />
      <div style={{ background: t.dark }} />
      <div style={{ background: t.dark }} />
      <div style={{ background: t.light }} />
      <img
        src={pieceUrl(pieceSet, 'w', 'n')}
        alt=""
        draggable={false}
        className="absolute inset-[8%] h-[84%] w-[84%]"
      />
    </div>
  );
}

/** King and knight of a piece set on a neutral tile. */
export function PieceSetPreview({ id, size = 56 }: { id: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-line"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <img src={pieceUrl(id, 'w', 'k')} alt="" draggable={false} className="h-[62%] w-[48%]" />
      <img
        src={pieceUrl(id, 'b', 'n')}
        alt=""
        draggable={false}
        className="-ml-[6%] h-[62%] w-[48%]"
      />
    </div>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
