import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: { '#safe-playwright-provider': fileURLToPath(new URL('./src/browser-provider.generated.js', import.meta.url)) },
  },
  test: { include: ['tests/*.test.ts'], maxWorkers: 1, fileParallelism: false },
});
