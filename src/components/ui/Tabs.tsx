import { motion } from 'framer-motion';
import { useId, type KeyboardEvent } from 'react';
import { cx } from '@/utils/format';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
}

/** Segmented tab strip with an animated indicator. Arrow keys move between tabs. */
export function Tabs<T extends string>({ items, value, onChange, className, label }: TabsProps<T>) {
  const group = useId();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    const next =
      enabled[(idx + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next) onChange(next.id);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className={cx('glass flex rounded-xl p-1', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cx(
              'relative flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              active ? 'text-white' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${group}`}
                className="absolute inset-0 rounded-lg bg-accent"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
