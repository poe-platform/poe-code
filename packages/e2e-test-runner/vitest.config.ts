import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadTestEnv } from '../../tests/test-env.ts';

loadTestEnv();

const packageRoot = path.resolve(__dirname);
const repoRoot = path.resolve(packageRoot, '../..');
const packageSrc = path.join(packageRoot, 'src');

export default defineConfig({
  resolve: {
    alias: {
      '@poe-code/e2e-test-runner': path.join(packageSrc, 'index.ts'),
      '@poe-code/e2e-test-runner/matchers': path.join(packageSrc, 'matchers.ts'),
      'auth-store': path.join(repoRoot, 'packages/auth-store/src/index.ts'),
    },
  },
  test: {
    root: repoRoot,
    globals: true,
    environment: 'node',
    pool: 'threads',
    include: ['packages/e2e-test-runner/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.e2e.test.ts'],
    setupFiles: [path.join(repoRoot, 'tests/setup.ts')],
  },
});
