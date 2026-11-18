import { randomBytes } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface ServerConfig {
  port: number;
  host: string;
  /** Apps older than this get UPGRADE_REQUIRED. */
  minAppVersion: string;
  /** When set, new connections are turned away with this message. */
  maintenanceMessage: string | null;
  logLevel: LogLevel;
  /** Behind a reverse proxy (Render, Caddy, Cloudflare): take the client IP from X-Forwarded-For. */
  trustProxy: boolean;
  /** Secret used to derive public player ids from guest ids. */
  idSecret: string;

  heartbeatMs: number;
  heartbeatTimeoutMs: number;
  /** How long a disconnected player has to come back before losing by abandonment. */
  graceMs: number;
  roomTtlMs: number;
  /** A side that hasn't made its first move within this time aborts the game. */
  firstMoveMs: number;
  /** Finished games stay available (rejoin, rematch) this long. */
  finishedTtlMs: number;
  /** Network lag credited to the mover per move, at most. */
  maxLagCreditMs: number;
  /** Shortest base time allowed for private games. */
  minBaseMs: number;
  /** On shutdown, wait this long for live games to finish. */
  shutdownGraceMs: number;

  ratePerSecond: number;
  rateBurst: number;
  roomsPerMinute: number;
  maxConnectionsPerIp: number;
  /** Rate-limit or bad-message strikes before the connection is closed. */
  maxStrikes: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 8080,
  host: '0.0.0.0',
  minAppVersion: '0.9.0',
  maintenanceMessage: null,
  logLevel: 'info',
  trustProxy: false,
  idSecret: '',

  heartbeatMs: 15_000,
  heartbeatTimeoutMs: 45_000,
  graceMs: 60_000,
  roomTtlMs: 10 * 60_000,
  firstMoveMs: 30_000,
  finishedTtlMs: 10 * 60_000,
  maxLagCreditMs: 500,
  minBaseMs: 60_000,
  shutdownGraceMs: 25_000,

  ratePerSecond: 20,
  rateBurst: 40,
  roomsPerMinute: 5,
  maxConnectionsPerIp: 10,
  maxStrikes: 10,
};

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/** Configuration from environment variables (see server/README.md). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const num = (key: string, fallback: number) => {
    const n = Number(env[key]);
    return env[key] !== undefined && Number.isFinite(n) ? n : fallback;
  };
  const level = env['LOG_LEVEL'] as LogLevel | undefined;
  return {
    ...DEFAULT_CONFIG,
    port: num('PORT', DEFAULT_CONFIG.port),
    host: env['HOST'] || DEFAULT_CONFIG.host,
    minAppVersion: env['MIN_APP_VERSION'] || DEFAULT_CONFIG.minAppVersion,
    maintenanceMessage: env['MAINTENANCE_MESSAGE'] || null,
    logLevel: level && LEVELS.includes(level) ? level : DEFAULT_CONFIG.logLevel,
    trustProxy: env['TRUST_PROXY'] === '1' || env['TRUST_PROXY'] === 'true',
    // Without a fixed secret, public ids change on every restart (harmless, just less stable).
    idSecret: env['ID_SECRET'] || randomBytes(32).toString('hex'),
    shutdownGraceMs: num('SHUTDOWN_GRACE_MS', DEFAULT_CONFIG.shutdownGraceMs),
    maxConnectionsPerIp: num('MAX_CONNECTIONS_PER_IP', DEFAULT_CONFIG.maxConnectionsPerIp),
  };
}
