import type { TimeControl } from '@shared/types';

export const TIME_CONTROLS: (TimeControl & { label: string; hint: string })[] = [
  { id: 'untimed', label: 'Untimed', hint: 'No clock', initialMs: 0, incrementMs: 0 },
  { id: '3+2', label: '3 + 2', hint: 'Blitz', initialMs: 3 * 60_000, incrementMs: 2_000 },
  { id: '5+3', label: '5 + 3', hint: 'Blitz', initialMs: 5 * 60_000, incrementMs: 3_000 },
  { id: '10+0', label: '10 + 0', hint: 'Rapid', initialMs: 10 * 60_000, incrementMs: 0 },
  { id: '15+10', label: '15 + 10', hint: 'Rapid', initialMs: 15 * 60_000, incrementMs: 10_000 },
];

export const CUSTOM_LIMITS = { minMinutes: 1, maxMinutes: 180, maxIncrement: 60 };

export function customTimeControl(minutes: number, incrementSec: number): TimeControl {
  const m = Math.min(
    CUSTOM_LIMITS.maxMinutes,
    Math.max(CUSTOM_LIMITS.minMinutes, Math.round(minutes)),
  );
  const i = Math.min(CUSTOM_LIMITS.maxIncrement, Math.max(0, Math.round(incrementSec)));
  return { id: `custom-${m}+${i}`, initialMs: m * 60_000, incrementMs: i * 1000 };
}

export function describeTimeControl(tc: TimeControl): string {
  if (tc.initialMs === 0) return 'Untimed';
  return `${tc.initialMs / 60_000} + ${tc.incrementMs / 1000}`;
}
