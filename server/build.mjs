// Bundles the server (and the protocol/rules it shares with the app) into dist/index.js.
import { build, context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // ws has optional native add-ons; load it from node_modules at runtime.
  external: ['ws'],
  alias: {
    '@shared': resolve(here, '../src/shared'),
    '@game': resolve(here, '../src/game'),
    'chess.js': resolve(here, 'node_modules/chess.js'),
  },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
