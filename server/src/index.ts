import { loadConfig } from './config';
import { createLogger } from './log';
import { createGameServer } from './server';

const config = loadConfig();
const log = createLogger(config.logLevel);
const server = createGameServer(config, { log });

// Log crashes as one JSON line (for the error log) before exiting; the container restarts it.
process.on('uncaughtException', (err) => {
  log.error('crash', { error: String(err), stack: err.stack?.split('\n').slice(0, 6).join(' | ') });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled.rejection', { error: String(reason) });
});

const port = await server.listen();
log.info('listening', {
  port,
  minAppVersion: config.minAppVersion,
  trustProxy: config.trustProxy,
  maintenanceFile: config.maintenanceFile !== null,
});

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
