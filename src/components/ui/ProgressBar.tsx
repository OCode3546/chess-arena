import { motion } from 'framer-motion';
import { cx } from '@/utils/format';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function ProgressBar({ value, label, className, size = 'md' }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={cx(
        'overflow-hidden rounded-full bg-surface-2',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
    >
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}
