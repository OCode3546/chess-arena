import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Slow AI simulations against the real engine: `npm run ai:sim`. */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['sim/**/*.sim.test.ts'],
    environment: 'node',
    testTimeout: 30 * 60_000,
  },
});
