import { levelProgress } from '@/progression/levels';
import { cx } from '@/utils/format';
import { ProgressBar } from './ui';

/** "Experience" row + bar for a profile's total XP; shows MAX at the level cap. */
export function XpBar({
  xp,
  size = 'md',
  showLabel = true,
  className,
}: {
  xp: number;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}) {
  const p = levelProgress(xp);
  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-semibold text-muted">Experience</span>
          <span className="tabular-nums text-muted">
            {p.max ? 'MAX' : `${p.into.toLocaleString()} / ${p.needed.toLocaleString()} XP`}
          </span>
        </div>
      )}
      <ProgressBar
        value={p.fraction}
        size={size}
        label={p.max ? 'Maximum level reached' : `Experience to level ${p.level + 1}`}
        className={cx(p.max && '[&>div]:from-warning [&>div]:to-accent-soft')}
      />
    </div>
  );
}
