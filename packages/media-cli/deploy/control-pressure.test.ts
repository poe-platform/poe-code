import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

it('reserves bounded cross-factory control capacity while data responses are unread', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { createMediaWorker } from './entrypoint.ts';
      export default { async fetch() {
        const forwarded = [];
        const options = {
          async authenticate() { return { namespaceId: 'alice', expiresAt: Date.now() + 60000 }; },
          driver: { async acquire() { return { async fetch(request) {
            forwarded.push(new URL(request.url).pathname);
            return new Response(new ReadableStream({}, { highWaterMark: 0 }));
          } }; } },
          journal: {}, async runtime() { throw new Error('Unexpected shell'); },
        };
        const responses = [];
        const send = async (path, method = 'POST') => {
          const response = await createMediaWorker(options).fetch(new Request('https://worker/v1/' + path, { method }));
          responses.push(response);
          return response.status;
        };
        try {
          for (let i = 0; i < 4; i++) await send('sessions/s/jobs/j/lanes/data', 'GET');
          const dataOverflow = await send('sessions/s/jobs/j/lanes/data', 'GET');
          const controls = [
            ['POST', 'sessions/s/jobs/j/cancel'],
            ['POST', 'sessions/s/jobs/j/signal'],
            ['POST', 'sessions/s/jobs/j/lanes/l/ack'],
            ['POST', 'sessions/s/jobs/j/callbacks/c/result'],
            ['POST', 'sessions/s/materializations/m/callbacks/c/result'],
            ['POST', 'sessions/s/materializations/m/lanes/l/ack'],
            ['POST', 'sessions/s/jobs/j/resources/release'],
            ['POST', 'sessions/s/lease'],
            ['DELETE', 'sessions/s'],
            ['DELETE', 'sessions/s/uploads/u'],
          ];
          const statuses = [];
          for (const [method, path] of controls) {
            statuses.push(await send(path, method));
            await responses.pop().body?.cancel();
          }
          const invalid = await send('sessions/s/jobs/j/cancel/extra');
          const wrongMethod = await send('sessions/s/jobs/j/cancel', 'GET');
          const held = [];
          for (let i = 0; i < 4; i++) held.push(await send('sessions/s/jobs/j/cancel'));
          const controlOverflow = await send('sessions/s/jobs/j/cancel');
          await responses[responses.length - 2].body?.cancel();
          const replacement = await send('sessions/s/jobs/j/cancel');
          return Response.json({ dataOverflow, statuses, invalid, wrongMethod, held, controlOverflow, replacement, forwarded: forwarded.length });
        } finally { await Promise.all(responses.map(response => response.body?.cancel())); }
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  try {
    expect(await (await worker.dispatchFetch('https://worker/')).json()).toEqual({
      dataOverflow: 429, statuses: Array(10).fill(200), invalid: 429, wrongMethod: 429,
      held: Array(4).fill(200), controlOverflow: 429, replacement: 200, forwarded: 19,
    });
  } finally { await worker.dispose(); }
});
