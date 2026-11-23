import {
  MAX_MESSAGE_BYTES,
  parseServerMsg,
  PROTOCOL_VERSION,
  type ClientMsg,
  type PlayerHello,
  type ServerMsg,
} from '@shared/protocol';
import { ClockSync, reconnectDelay } from './timing';

/**
 * - `idle`: not started.
 * - `connecting`: first attempt (or a manual retry) in progress.
 * - `online`: connected and welcomed by the server.
 * - `reconnecting`: the connection dropped; trying again in the background.
 * - `offline`: the server could not be reached; still retrying in the background.
 * - `upgrade`: this app version is too old for the server (no retries).
 * - `busy`: the server is in maintenance or restarting (retries slowly).
 * - `replaced`: the same player connected from another window (no retries).
 */
export type ConnStatus =
  'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'upgrade' | 'busy' | 'replaced';

/** Close codes the server uses (see server/src/hub.ts). */
const CLOSE_UPGRADE = 4000;
const CLOSE_BUSY = 4001;
const CLOSE_REPLACED = 4002;

/** App-level pings measure the clock offset and detect dead links (e.g. a pulled cable). */
export const PING_MS = 4_000;
/** No message for this long = the link is dead; reconnect. */
export const SILENCE_MS = 10_000;
/** A connection attempt that hasn't opened by now is abandoned. */
const CONNECT_TIMEOUT_MS = 8_000;
/** Consecutive failed attempts after which a dropped connection is reported as offline. */
const OFFLINE_AFTER = 3;
const BUSY_RETRY_MS = 30_000;

/** The subset of the browser WebSocket the connection uses (tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface ConnectionDeps {
  createSocket(url: string): SocketLike;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export interface ConnectionEvents {
  status(status: ConnStatus, detail: string | null): void;
  /** Every valid message after `welcome` (and `welcome` itself). */
  message(msg: ServerMsg): void;
}

export interface HelloInfo {
  appVersion: string;
  player: PlayerHello;
}

const OPEN = 1;

const browserDeps = (): ConnectionDeps => ({
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
  random: Math.random,
});

/**
 * One WebSocket to the game server, kept alive while wanted: says hello on every connect,
 * pings to measure the clock offset and notice dead links, and reconnects with exponential
 * backoff and jitter. Messages are validated with the shared protocol parsers.
 */
export class Connection {
  readonly clock = new ClockSync();
  private socket: SocketLike | null = null;
  private wanted = false;
  private welcomed = false;
  private attempt = 0;
  /** A session was welcomed since `start()`: later drops are "reconnecting", not "offline". */
  private everOnline = false;
  private status: ConnStatus = 'idle';
  private detail: string | null = null;
  /** Why the server refused us before its welcome (shown with the status). */
  private refusal: string | null = null;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private watchdog: unknown = null;
  private connectTimer: unknown = null;
  private pings = new Map<number, number>();
  private readonly deps: ConnectionDeps;

  constructor(
    private readonly url: string,
    private readonly hello: () => HelloInfo,
    private readonly events: ConnectionEvents,
    deps?: Partial<ConnectionDeps>,
  ) {
    this.deps = { ...browserDeps(), ...deps };
  }

  get state(): ConnStatus {
    return this.status;
  }

  get isOnline(): boolean {
    return this.welcomed;
  }

  /** Connect (if not already) and stay connected until `stop()`. */
  start(): void {
    if (this.status === 'upgrade') return;
    this.wanted = true;
    if (!this.socket && this.retryTimer === null) this.open();
  }

  /** Disconnect and stop reconnecting. */
  stop(): void {
    this.wanted = false;
    this.clearRetry();
    this.drop(1000, 'bye');
    this.everOnline = false;
    this.attempt = 0;
    this.setStatus('idle', null);
  }

  /** Try again right now (the "Retry" button, or the OS reporting the network is back). */
  retryNow(): void {
    if (!this.wanted || this.status === 'upgrade') return;
    if (this.socket) return;
    this.clearRetry();
    this.open();
  }

  /** Reconnect with a fresh hello (e.g. after the display name changed). */
  restart(): void {
    if (!this.wanted) return;
    this.drop(1000, 'restart');
    this.clearRetry();
    this.open();
  }

  /** The link is known to be down (the OS went offline): drop it now instead of waiting. */
  linkLost(): void {
    if (this.socket) this.onClosed(this.socket, 1006);
  }

  /** Send a message; false if not connected (the caller decides what to do). */
  send(msg: ClientMsg): boolean {
    if (!this.socket || !this.welcomed || this.socket.readyState !== OPEN) return false;
    const text = JSON.stringify(msg);
    if (text.length > MAX_MESSAGE_BYTES) return false;
    this.socket.send(text);
    return true;
  }

  // -------------------------------------------------------------------------

  private open(): void {
    this.setStatus(this.everOnline ? 'reconnecting' : 'connecting', null);
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    this.connectTimer = this.deps.setTimeout(() => {
      if (this.socket === socket && socket.readyState !== OPEN) this.onClosed(socket, 1006);
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearTimer('connectTimer');
      const { appVersion, player } = this.hello();
      socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, appVersion, player }));
      this.armWatchdog();
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket || typeof ev.data !== 'string') return;
      this.armWatchdog();
      const msg = parseServerMsg(ev.data);
      if (msg) this.onMessage(msg);
    };
    socket.onclose = (ev) => this.onClosed(socket, ev.code);
    socket.onerror = () => {
      // A close event always follows.
    };
  }

  private onMessage(msg: ServerMsg): void {
    if (msg.t === 'pong') {
      const sent = this.pings.get(msg.ts);
      if (sent !== undefined) {
        this.pings.delete(msg.ts);
        this.clock.add(sent, msg.serverTs, this.deps.now());
      }
      return;
    }
    if (msg.t === 'welcome') {
      this.welcomed = true;
      this.everOnline = true;
      this.attempt = 0;
      this.setStatus('online', null);
      this.startPinging();
      this.events.message(msg);
      return;
    }
    if (!this.welcomed) {
      // Before the welcome only refusals arrive: remember why for the status line.
      if (msg.t === 'error') this.refusal = msg.message;
      return;
    }
    this.events.message(msg);
  }

  private onClosed(socket: SocketLike, code: number): void {
    if (this.socket !== socket) return;
    const reason = this.refusal;
    this.refusal = null;
    this.drop(1000, 'closed');
    if (code === CLOSE_UPGRADE) {
      this.wanted = false;
      this.setStatus('upgrade', reason ?? 'Please update Chess Arena to play online.');
      return;
    }
    if (code === CLOSE_REPLACED) {
      this.wanted = false;
      this.setStatus('replaced', 'You connected from another Chess Arena window.');
      return;
    }
    if (!this.wanted) return;
    if (code === CLOSE_BUSY) {
      this.setStatus('busy', reason ?? 'The server is busy. Trying again shortly…');
      this.scheduleRetry(BUSY_RETRY_MS);
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry(fixedMs?: number): void {
    if (!this.wanted) return;
    const delay = fixedMs ?? reconnectDelay(this.attempt, this.deps.random);
    this.attempt++;
    if (this.status !== 'busy') {
      this.setStatus(
        this.everOnline && this.attempt < OFFLINE_AFTER ? 'reconnecting' : 'offline',
        null,
      );
    }
    this.clearRetry();
    this.retryTimer = this.deps.setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted && !this.socket) this.open();
    }, delay);
  }

  private startPinging(): void {
    this.clearTimer('pingTimer');
    // A few quick pings first so the clock offset is known before a game starts.
    let quick = 3;
    const ping = () => {
      if (!this.welcomed || !this.socket) return;
      const ts = this.deps.now();
      this.pings.set(ts, ts);
      if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value!);
      this.send({ t: 'ping', ts });
      this.pingTimer = this.deps.setTimeout(ping, quick-- > 0 ? 300 : PING_MS);
    };
    ping();
  }

  private armWatchdog(): void {
    this.clearTimer('watchdog');
    const socket = this.socket;
    this.watchdog = this.deps.setTimeout(() => {
      if (socket && this.socket === socket) this.onClosed(socket, 1006);
    }, SILENCE_MS);
  }

  /** Forget the current socket (closing it if needed) and its timers. */
  private drop(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.welcomed = false;
    this.pings.clear();
    this.clearTimer('pingTimer');
    this.clearTimer('watchdog');
    this.clearTimer('connectTimer');
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try {
      socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private clearTimer(key: 'pingTimer' | 'watchdog' | 'connectTimer'): void {
    if (this[key] !== null) this.deps.clearTimeout(this[key]);
    this[key] = null;
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setStatus(status: ConnStatus, detail: string | null): void {
    if (status === this.status && detail === this.detail) return;
    this.status = status;
    this.detail = detail;
    this.events.status(status, detail);
  }
}
