import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
      '@game': resolve(__dirname, '../src/game'),
      'chess.js': resolve(__dirname, 'node_modules/chess.js'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
