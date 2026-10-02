import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 resolve: { alias: {
  '@cloudflare/sandbox': fileURLToPath(new URL('../../remote-execution/testing/cloudflare-sdk.ts', import.meta.url)),
 } },
 test: { include: ['deploy/sandbox.test.ts', 'deploy/import-closure.test.ts', 'deploy/workerd.test.ts', 'deploy/control-pressure.test.ts'], maxWorkers: 1 },
});
