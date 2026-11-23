/** Reconnect delays and server-clock estimation for the online client. */

export const BACKOFF = { baseMs: 1_000, maxMs: 15_000 };

/**
 * Delay before reconnect attempt `attempt` (0-based): exponential, capped, with jitter so
 * many clients dropped at once don't all come back in the same instant. The delay lies
 * between half and all of the exponential step.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** Math.max(0, attempt));
  return Math.round(step * (0.5 + random() * 0.5));
}

interface Sample {
  rtt: number;
  /** Server clock minus local clock. */
  offset: number;
}

/**
 * Estimates the offset between the server's clock and ours from ping/pong round trips
 * (NTP-style: the server stamped the pong half-way through the round trip). The sample
 * with the shortest round trip among the recent ones is the most accurate.
 */
export class ClockSync {
  private samples: Sample[] = [];

  constructor(private readonly keep = 8) {}

  /** A pong for a ping sent at local `sentAt` arrived at local `receivedAt`. */
  add(sentAt: number, serverTs: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (!(rtt >= 0) || rtt > 30_000) return;
    this.samples.push({ rtt, offset: serverTs - (sentAt + rtt / 2) });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  private best(): Sample | undefined {
    let best: Sample | undefined;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best;
  }

  /** Server clock minus local clock (0 until a round trip has been measured). */
  get offset(): number {
    return this.best()?.offset ?? 0;
  }

  /** Shortest recent round-trip time, if any. */
  get rtt(): number | null {
    return this.best()?.rtt ?? null;
  }

  /** A server timestamp on our clock. */
  toLocal(serverTs: number): number {
    return serverTs - this.offset;
  }

  reset(): void {
    this.samples = [];
  }
}
