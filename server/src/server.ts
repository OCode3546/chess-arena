import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  parseClientMsg,
  PROTOCOL_VERSION,
  WS_PATH,
  type ServerMsg,
} from '@shared/protocol';
import type { ServerConfig } from './config';
import { CLOSE, Hub, type Conn } from './hub';
import { createLogger, type Logger } from './log';
import { TokenBucket } from './rateLimit';
import { realTimers, type Timers } from './time';

export interface GameServer {
  readonly hub: Hub;
  readonly http: Server;
  /** Start listening; resolves with the actual port. */
  listen(): Promise<number>;
  /** Drain: no new games, wait for live ones (up to the configured grace), then stop. */
  shutdown(): Promise<void>;
}

class SocketConn implements Conn {
  lagMs = 0;
  lastPongAt: number;
  pingSentAt = 0;
  strikes = 0;
  readonly bucket: TokenBucket;

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
    now: number,
    config: ServerConfig,
  ) {
    this.lastPongAt = now;
    this.bucket = new TokenBucket(config.ratePerSecond, config.rateBurst, now);
  }

  send(msg: ServerMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(code, reason);
    }
  }
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    // The proxy appends the address it saw, so the last entry is the one we can trust.
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1]!;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createGameServer(
  config: ServerConfig,
  deps: { timers?: Timers; log?: Logger } = {},
): GameServer {
  const timers = deps.timers ?? realTimers;
  const log = deps.log ?? createLogger(config.logLevel);
  const hub = new Hub(config, timers, log);
  const startedAt = Date.now();
  const conns = new Set<SocketConn>();
  const perIp = new Map<string, number>();
  let draining = false;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/health') {
      const body = JSON.stringify({
        status: draining ? 'draining' : 'ok',
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        ...hub.stats(),
      });
      res.writeHead(draining ? 503 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Chess Arena game server\n');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  http.on('upgrade', (req, socket, head) => {
    const reject = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if ((req.url ?? '').split('?')[0] !== WS_PATH) return reject(404, 'Not Found');
    if (draining) return reject(503, 'Service Unavailable');
    const ip = clientIp(req, config.trustProxy);
    if ((perIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
      return reject(429, 'Too Many Requests');
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  function strike(conn: SocketConn): void {
    if (++conn.strikes > config.maxStrikes) {
      log.warn('conn.closed.strikes', { ip: conn.ip });
      conn.close(CLOSE.policy, 'too many bad messages');
    }
  }

  function onConnection(ws: WebSocket, ip: string): void {
    const conn = new SocketConn(ws, ip, timers.now(), config);
    conns.add(conn);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    hub.connect(conn);

    ws.on('message', (data, isBinary) => {
      if (!conn.bucket.take(timers.now())) {
        conn.send({ t: 'error', code: 'RATE_LIMIT', message: 'Slow down.' });
        return strike(conn);
      }
      const msg = isBinary ? null : parseClientMsg(data.toString());
      if (!msg) strike(conn);
      hub.handle(conn, msg);
    });
    ws.on('pong', () => {
      const now = timers.now();
      conn.lastPongAt = now;
      if (conn.pingSentAt) {
        const oneWay = (now - conn.pingSentAt) / 2;
        conn.lagMs = conn.lagMs ? Math.round(conn.lagMs * 0.7 + oneWay * 0.3) : Math.round(oneWay);
      }
    });
    ws.on('close', () => {
      conns.delete(conn);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      hub.disconnect(conn);
    });
    ws.on('error', (err) => log.debug('conn.error', { error: err.message }));
  }

  // Heartbeats keep proxies from dropping idle sockets, find dead peers and measure lag.
  const heartbeat = setInterval(() => {
    const now = timers.now();
    for (const conn of conns) {
      if (now - conn.lastPongAt > config.heartbeatTimeoutMs) {
        conn.ws.terminate();
        continue;
      }
      conn.pingSentAt = now;
      conn.ws.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  return {
    hub,
    http,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          resolve((http.address() as AddressInfo).port);
        });
      }),
    async shutdown() {
      draining = true;
      hub.startDraining();
      const deadline = Date.now() + config.shutdownGraceMs;
      while (hub.liveGames > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
      }
      hub.endAllGames();
      clearInterval(heartbeat);
      for (const conn of conns) conn.close(1001, 'server shutting down');
      await new Promise<void>((resolve) => {
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
