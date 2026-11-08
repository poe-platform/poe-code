import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: {
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat_v2', 'global_fetch_strictly_public', 'enable_nodejs_fs_module', 'enable_request_signal', 'enable_nodejs_http_modules', 'enable_nodejs_os_module', 'enable_nodejs_http2_module', 'enable_nodejs_process_v2'],
    // Load the prebundled provider as a native Worker module. Vite's transform
    // and source map exceed the test pool's WebSocket message size limit.
    modulesRules: [{ type: 'ESModule', include: ['**/browser-provider.generated.js'] }],
  } })],
  test: { include: ['tests/*.test.cloudflare.ts'], testTimeout: 20000, fileParallelism: false },
});
