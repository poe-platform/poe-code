import { defineConfig } from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 resolve:{alias:{
  'modal':fileURLToPath(new URL('./testing/modal-sdk.ts',import.meta.url)),
  '@cloudflare/sandbox':fileURLToPath(new URL('./testing/cloudflare-sdk.ts',import.meta.url)),
  'poe-code/safe-fs/core':fileURLToPath(new URL('../safe-fs/src/core.ts',import.meta.url)),
 }},
 test: { include: ['src/**/*.test.ts'], maxWorkers: 2 },
});
