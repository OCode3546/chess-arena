export const NAME_MAX = 24;

export const inputClass =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent-soft';

export const cleanName = (s: string) => s.trim().slice(0, NAME_MAX);
