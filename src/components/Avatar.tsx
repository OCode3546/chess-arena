import { avatarById } from '@/config/avatars';
import { pieceUrl } from '@/config/pieces';
import { badgeTier, cosmeticsFor, TITLES } from '@/config/rewards';
import type { Profile } from '@shared/types';
import { cx } from '@/utils/format';

/** Frame thickness relative to the avatar size. */
const FRAME_RATIO = 0.07;

export function Avatar({
  id,
  size = 48,
  frame = 'none',
  className,
}: {
  id: string;
  size?: number;
  /** Equipped avatar frame id. */
  frame?: string;
  className?: string;
}) {
  const a = avatarById(id);
  const framed = frame !== 'none';
  const pad = framed ? Math.max(2, Math.round(size * FRAME_RATIO)) : 0;
  const inner = size - pad * 2;
  const face = (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center shadow-lg ring-1 ring-white/15',
        framed ? 'rounded-[inherit]' : cx('rounded-2xl', className),
        a.legendary && 'avatar-legendary',
      )}
      style={{
        width: inner,
        height: inner,
        background: a.legendary ? undefined : `linear-gradient(135deg, ${a.from}, ${a.to})`,
      }}
      role={framed ? undefined : 'img'}
      aria-label={framed ? undefined : a.name}
    >
      <img
        src={pieceUrl('modern', 'w', a.piece)}
        alt=""
        draggable={false}
        style={{ width: inner * 0.72, height: inner * 0.72 }}
      />
    </div>
  );
  if (!framed) return face;
  return (
    <div
      className={cx('shrink-0 rounded-2xl', `frame-${frame}`, className)}
      style={{ width: size, height: size, padding: pad }}
      role="img"
      aria-label={a.name}
      data-frame={frame}
    >
      {face}
    </div>
  );
}

/** A profile's avatar with its equipped frame (locked items fall back to the defaults). */
export function ProfileAvatar({
  profile,
  size,
  className,
}: {
  profile: Profile;
  size?: number;
  className?: string;
}) {
  const look = cosmeticsFor(profile);
  return <Avatar id={look.avatarId} frame={look.frame} size={size} className={className} />;
}

export function LevelBadge({ level, className }: { level: number; className?: string }) {
  const tier = badgeTier(level);
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold text-white',
        `badge-${tier.id}`,
        className,
      )}
      title={`${tier.name} badge`}
    >
      Lv {level}
    </span>
  );
}

/** Equipped title, e.g. "Knight Errant". */
export function TitleTag({ id, className }: { id?: string; className?: string }) {
  if (!id || !TITLES[id]) return null;
  return (
    <span
      className={cx('truncate text-xs font-semibold text-accent-text', className)}
      data-title={id}
    >
      {TITLES[id]}
    </span>
  );
}
