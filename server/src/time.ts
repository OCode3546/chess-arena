/** Time source and timers, injectable so game logic can be tested without waiting. */
export interface Timers {
  /** Milliseconds; monotonic, close to wall-clock time. */
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  // performance.now() never jumps backwards (NTP adjustments), unlike Date.now().
  now: () => Math.round(performance.timeOrigin + performance.now()),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Manually advanced clock for unit tests. */
export class FakeTimers implements Timers {
  private time = 1_000_000;
  private nextId = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }

  set(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Move time forward, firing due timers in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.pending) {
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.pending.delete(next[0]);
      this.time = next[1].at;
      next[1].fn();
    }
    this.time = end;
  }

  get timerCount(): number {
    return this.pending.size;
  }
}
