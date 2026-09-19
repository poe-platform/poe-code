import type { BrowserWorker } from '@cloudflare/playwright';
import { createPlaywrightController, checkpointBrowserProfile, parseBrowserProfile, restoreBrowserProfile,
  type PlaywrightOperationOutcome } from '@poe-platform/safe-bash/playwright';
import { createCloudflarePlaywrightAdapter } from '../src/index.js';

interface Env { BROWSER: BrowserWorker; RECOVERY: KVNamespace; }
const limits = { maxBytes: 1024 * 1024, maxTabs: 4 };
export default { async fetch(request: Request, env: Env) {
  const signal = new AbortController().signal;
  const adapter = createCloudflarePlaywrightAdapter(env.BROWSER);
  const controller = createPlaywrightController({ adapter, abilities: {
    press: { scope: 'session', async execute({ browserSession }) {
      await browserSession!.page!.evaluate!(async () => {
        await fetch('/effect', { method: 'POST' });
      }, undefined);
    } },
  }, persistence: {
    async restore() { throw new Error('Inspection must never restore'); },
    async checkpoint() {}, async delete() {},
    async inspectRecovery() {
      return { hasStorage: await env.RECOVERY.get('profile') !== null,
        ...((await env.RECOVERY.get('operation', 'json')) ? { operation: (await env.RECOVERY.get('operation', 'json')) as PlaywrightOperationOutcome } : {}) };
    },
    async recordOperation({ operation }) { await env.RECOVERY.put('operation', JSON.stringify(operation)); },
  } });
  if (new URL(request.url).pathname === '/start') {
    const origin = await request.text();
    const lease = await adapter.acquire({ acquisitionId: 'recovery-start', session: 'owned', browser: 'chromium', headless: true, signal });
    const page = await lease.context.newPage();
    await page.goto(origin + '/one-time?token=never-print');
    await controller.restoreSession({ name: 'owned', async acquire() { return { lease, selectedPage: page }; } });
    await env.RECOVERY.put('profile', await checkpointBrowserProfile(controller.inspectSessions()[0]!, limits, signal));
    await controller.run({ args: ['-s=owned', 'press', 'Enter'], operationId: 'post-112', env: {}, signal, async write() {} });
    return Response.json(await controller.inspectRecovery({ name: 'owned' }));
  }
  try {
    if (new URL(request.url).pathname === '/recover') {
      const bytes = await env.RECOVERY.get('profile', 'arrayBuffer');
      if (!bytes) throw new Error('Missing profile');
      const restored = await restoreBrowserProfile({ adapter, profile: parseBrowserProfile(new Uint8Array(bytes), limits), limits,
        name: 'owned', signal, recovery: true });
      await controller.restoreSession({ name: 'owned', recovery: restored.recovery,
        async acquire() { return restored; } });
      if (controller.inspectSessions()[0]!.selectedPage!.url() !== 'about:blank') throw new Error('Recovery must be inert');
    }
    return Response.json(await controller.inspectRecovery({ name: 'owned' }));
  } finally { await controller.dispose(); }
} };
