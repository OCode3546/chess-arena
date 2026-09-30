import { useId } from 'react';
import { cx } from '@/utils/format';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className={cx('flex items-center justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <label htmlFor={id} className="cursor-pointer">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line transition-colors',
          checked ? 'bg-accent' : 'bg-surface-2',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
