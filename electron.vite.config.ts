import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/** Production game server (spec §13.6). */
const PRODUCTION_SERVER = 'wss://play.chessarena.dpdns.org/ws';
const DEV_SERVER = 'ws://localhost:8080/ws';

/**
 * The game server URL is fixed at build time: `CHESS_ARENA_SERVER_URL` overrides it (e.g. a
 * local server for tests); otherwise dev builds use localhost and release builds production.
 * Only `wss://` is allowed except for a server on this machine.
 */
function serverUrl(dev: boolean): string {
  const raw = process.env['CHESS_ARENA_SERVER_URL'] || (dev ? DEV_SERVER : PRODUCTION_SERVER);
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) {
    throw new Error(`CHESS_ARENA_SERVER_URL must be a wss:// URL (got ${raw})`);
  }
  return url.toString();
}

/** Injects the Content-Security-Policy. Dev needs inline scripts + websocket for HMR. */
function csp(server: string): Plugin {
  const origin = new URL(server).origin.replace(/^http/, 'ws');
  const prod = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${origin}; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const dev = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://localhost:* ${origin}; object-src 'none'; base-uri 'none'`;
  let isDev = false;
  return {
    name: 'chess-arena-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      return html.replace('%CSP%', isDev ? dev : prod);
    },
  };
}

export default defineConfig(({ command }) => {
  const server = serverUrl(command === 'serve');
  return {
    main: {
      resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
      build: {
        lib: { entry: resolve(__dirname, 'electron/main.ts') },
      },
    },
    preload: {
      resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
      define: { __SERVER_URL__: JSON.stringify(server) },
      build: {
        lib: { entry: resolve(__dirname, 'electron/preload.ts') },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src'),
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      plugins: [react(), tailwindcss(), csp(server)],
      build: {
        rollupOptions: { input: resolve(__dirname, 'src/index.html') },
      },
    },
  };
});
