import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@poe-code/e2e-docker-test-runner': path.resolve(__dirname, '../packages/e2e-docker-test-runner/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    testTimeout: 300000,
    hookTimeout: 300000,
    include: ['*.test.ts'],
    maxWorkers: 1,
  },
});
