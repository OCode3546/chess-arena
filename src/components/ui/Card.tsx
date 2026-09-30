import type { HTMLAttributes } from 'react';
import { cx } from '@/utils/format';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('glass rounded-2xl p-5', className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cx('font-display text-lg font-bold tracking-tight', className)} {...rest} />
  );
}
