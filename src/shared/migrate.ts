export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrade a persisted document to `target` by running every migration whose key is
 * greater than the stored `schemaVersion`. A missing version is treated as 0.
 * Documents written by a newer app version are returned unchanged.
 */
export function migrate(
  data: Record<string, unknown>,
  migrations: Record<number, Migration>,
  target: number,
): { data: Record<string, unknown>; changed: boolean } {
  const from = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (from >= target) return { data, changed: false };
  let next = { ...data };
  for (let v = from + 1; v <= target; v++) {
    const step = migrations[v];
    if (step) next = step(next);
    next.schemaVersion = v;
  }
  return { data: next, changed: true };
}
