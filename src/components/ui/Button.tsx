import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/utils/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_8px_24px_-10px_var(--accent)] hover:brightness-110 active:brightness-95',
  secondary: 'glass text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-14 px-6 text-base gap-3 rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    block,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-[background,filter,color,transform] duration-150 active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none cursor-pointer',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
