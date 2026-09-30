import { avatarById } from '@/config/avatars';
import { pieceUrl } from '@/config/pieces';
import { cx } from '@/utils/format';

export function Avatar({
  id,
  size = 48,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const a = avatarById(id);
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-2xl shadow-lg ring-1 ring-white/15',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${a.from}, ${a.to})`,
      }}
      role="img"
      aria-label={a.name}
    >
      <img
        src={pieceUrl('modern', 'w', a.piece)}
        alt=""
        draggable={false}
        style={{ width: size * 0.72, height: size * 0.72 }}
      />
    </div>
  );
}

export function LevelBadge({ level, className }: { level: number; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-full bg-accent px-2.5 text-xs font-bold text-white shadow-[0_4px_14px_-6px_var(--accent)]',
        className,
      )}
    >
      Lv {level}
    </span>
  );
}
