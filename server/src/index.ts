import { loadConfig } from './config';
import { createLogger } from './log';
import { createGameServer } from './server';

const config = loadConfig();
const log = createLogger(config.logLevel);
const server = createGameServer(config, { log });

const port = await server.listen();
log.info('listening', { port, minAppVersion: config.minAppVersion, trustProxy: config.trustProxy });

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info('shutting down', { signal, liveGames: server.hub.liveGames });
    server.shutdown().then(
      () => process.exit(0),
      (err: unknown) => {
        log.error('shutdown failed', { error: String(err) });
        process.exit(1);
      },
    );
  });
}
