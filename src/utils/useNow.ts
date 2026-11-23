import { useCallback, useSyncExternalStore } from 'react';

/**
 * The current time, refreshed every `ms` while `on` (for countdowns and elapsed timers).
 * Rounded down to `ms` so repeated reads within one tick agree.
 */
export function useNow(on: boolean, ms = 500): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!on) return () => {};
      const t = window.setInterval(notify, ms);
      return () => window.clearInterval(t);
    },
    [on, ms],
  );
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / ms) * ms);
}
