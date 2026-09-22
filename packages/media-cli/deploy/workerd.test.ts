import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

it('holds job forwarding credits across factories until streaming retirement inside workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { createMediaWorker } from './entrypoint.ts';
      export default { async fetch() {
        let acquired = 0;
        let canceled = 0;
        const options = {
          async authenticate() { return { namespaceId: 'alice', expiresAt: Date.now() + 60000 }; },
          driver: { async acquire() { acquired++; return { async fetch() {
            return new Response(new ReadableStream({ cancel() { canceled++; } }, { highWaterMark: 0 }));
          } }; } },
          journal: {}, async runtime() { throw new Error('Job forwarding does not start a shell'); },
        };
        const request = () => new Request('https://worker/v1/jobs/job/stdout');
        const responses = [];
        try {
          for (let i = 0; i < 4; i++) responses.push(await createMediaWorker(options).fetch(request()));
          const overflow = await createMediaWorker(options).fetch(request());
          if (overflow.status === 200) responses.push(overflow);
          const before = acquired;
          await responses.shift().body.cancel('disconnect');
          const replacement = await createMediaWorker(options).fetch(request());
          responses.push(replacement);
          return Response.json({ overflow: overflow.status, before, canceled, replacement: replacement.status });
        } finally { await Promise.all(responses.map(response => response.body.cancel('fixture retirement'))); }
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  try {
    expect(await (await worker.dispatchFetch('https://worker/')).json()).toEqual({
      overflow: 429, before: 4, canceled: 1, replacement: 200,
    });
  } finally { await worker.dispose(); }
});

it('retires unread upload producers at container transfer completion inside workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { createWorkerTransport } from './transport.ts';
      export default { async fetch() {
        const results = [];
        for (const mode of ['rejected', 'empty-response', 'response-eof']) {
          const abort = new AbortController();
          let canceled = 0;
          const endpoint = { async fetch() {
            if (mode === 'rejected') throw new Error('Container unavailable');
            return new Response(mode === 'response-eof' ? new Uint8Array([255]) : null);
          } };
          try {
            const response = await createWorkerTransport(endpoint, abort.signal, abort)(
              'https://container.internal/v1/blob', { method: 'PUT',
                body: new ReadableStream({ cancel() { canceled++; } }, { highWaterMark: 0 }) });
            if (response.body) {
              const reader = response.body.getReader();
              while (!(await reader.read()).done) {}
              reader.releaseLock();
            }
          } catch (error) {
            if (mode !== 'rejected' || error.message !== 'Container unavailable') throw error;
          }
          results.push({ mode, canceled, aborted: abort.signal.aborted });
        }
        return Response.json(results);
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  try {
    expect(await (await worker.dispatchFetch('https://worker/')).json()).toEqual(
      ['rejected', 'empty-response', 'response-eof'].map(mode => ({ mode, canceled: 1, aborted: false })),
    );
  } finally { await worker.dispose(); }
});

it('bounds canonical blob transport inside workerd and retains swallowed violations', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createMediaWorker } from './entrypoint.ts';
      export default { async fetch(request) {
        let record;
        let canceled = 0;
        let failure;
        const retirement = [];
        const media = createMediaWorker({
          async authenticate() { return { namespaceId: 'alice', expiresAt: Date.now() + 60000 }; },
          driver: { async acquire() { return { async fetch() {
            return new Response(new ReadableStream({
              start(controller) { controller.enqueue(new Uint8Array(65537)); },
              cancel() { canceled++; },
            }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'epoch' } });
          } }; } },
          journal: {
            async accept(owner, key, value) { record = structuredClone(value); return true; },
            async inspect() { return record; },
            async put(owner, key, value) { record = structuredClone(value); },
          },
          async runtime({ client }) {
            return { fs: new MemoryFileSystem(), async close() {}, engine: {
              async execute() {
                try {
                  const response = await client.readBlobRange({ sessionId: 'session', epoch: 'epoch' }, 'blob', 0n);
                  await response.body.getReader().read();
                } catch (error) { failure = error.message + (error.cause ? ': ' + error.cause.message : ''); }
                return { exitCode: 0 };
              },
            } };
          },
        });
        const response = await media.fetch(new Request('https://worker/command', {
          method: 'POST', headers: { 'Idempotency-Key': 'blob', 'Shell-Command': 'ffmpeg -version' },
        }), { waitUntil(task) { retirement.push(task); } });
        await response.body.getReader().read().catch(() => {});
        await Promise.all(retirement);
        return Response.json({ record, canceled, failure });
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  try {
    const response = await worker.dispatchFetch('https://worker/');
    expect(await response.json()).toEqual({
      canceled: 1, failure: 'Transfer byte limit',
      record: { command: 'ffmpeg -version', state: 'recovery-required', stdoutOffset: '0', stderrOffset: '0' },
    });
  } finally { await worker.dispose(); }
});

it('retires denied authorization service bodies before returning from the media route', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { createDeploymentWorker } from './worker.ts';
      let canceled = 0;
      const deployment = createDeploymentWorker(async () => {
        throw new Error('Denied callers cannot acquire canonical authority');
      });
      const env = { AUTHORIZATION: { async fetch() {
        return new Response(new ReadableStream({
          cancel() { canceled++; }
        }, { highWaterMark: 0 }), { status: 403 });
      } } };
      export default { async fetch(request, bindings, context) {
        const response = await deployment.fetch(request, env, context);
        return Response.json({ status: response.status, canceled });
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], external: ['cloudflare:workers', 'node:*'],
    format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-09-14', compatibilityFlags: ['nodejs_compat'],
  }));
  try {
    for (const path of ['/command/status', '/v1/capabilities']) {
      const response = await worker.dispatchFetch('https://worker' + path, {
        headers: { Authorization: 'Bearer denied', 'Idempotency-Key': 'denied' },
      });
      expect(await response.json()).toEqual({ status: 401, canceled: path === '/command/status' ? 1 : 2 });
    }
  } finally { await worker.dispose(); }
});

it('retires a canceled command stream and inspects recovery without replay inside workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createMediaWorker } from './entrypoint.ts';
      let record;
      let executions = 0;
      let closed = 0;
      let canceled = false;
      let started;
      const entered = new Promise(resolve => { started = resolve; });
      const media = createMediaWorker({
        async authenticate(request) {
          return request.headers.get('Authorization') === 'Bearer alice'
            ? { namespaceId: 'alice', expiresAt: Date.now() + 60000 } : null;
        },
        driver: { async acquire() { return { async fetch() {
          throw new Error('No native Sandbox execution in this fixture');
        } }; } },
        journal: {
          async accept(owner, key, value) {
            if (record) return false;
            record = structuredClone(value); return true;
          },
          async inspect() { return record; },
          async put(owner, key, value) { record = structuredClone(value); },
        },
        async runtime({ signal, persistNative }) {
          await persistNative([{ sessionId: 'session', epoch: 'epoch', jobId: 'job' }], []);
          return { fs: new MemoryFileSystem(), async close() {
            closed++; canceled = signal.aborted;
            await persistNative([], [{ jobId: 'job', receiptId: 'cleanup', digest: 'digest' }]);
          }, engine: { async execute(request) {
            executions++;
            started();
            await request.stdout.write(new Uint8Array([0, 128, 255]));
            return { exitCode: 0 };
          } } };
        },
      });
      export default { async fetch(request) {
        if (new URL(request.url).pathname !== '/fixture/disconnect') return media.fetch(request);
        const retirement = [];
        const response = await media.fetch(new Request('https://worker/command', {
          method: 'POST', headers: { Authorization: 'Bearer alice',
            'Idempotency-Key': 'disconnected', 'Shell-Command': 'ffmpeg -version' },
        }), { waitUntil(task) { retirement.push(task); } });
        await entered;
        // Cancel before returning a response credit, while its binary write is blocked.
        await response.body.cancel('fixture disconnect');
        await Promise.all(retirement);
        return Response.json({ executions, closed, canceled, record });
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  const headers = { Authorization: 'Bearer alice', 'Idempotency-Key': 'disconnected', 'Shell-Command': 'ffmpeg -version' };
  try {
    const response = await worker.dispatchFetch('https://worker/fixture/disconnect');
    expect(await response.json()).toMatchObject({
      executions: 1, closed: 1, canceled: true,
      record: { state: 'recovery-required', stdoutOffset: '0',
        nativeJobs: [{ jobId: 'job' }], effectReceipts: [{ receiptId: 'cleanup' }] },
    });
    const status = await worker.dispatchFetch('https://worker/command/status', { headers });
    expect(await status.json()).toMatchObject({
      state: 'recovery-required', recovery: 'inspect-native-job-and-effects; start-new-shell',
    });
    expect((await worker.dispatchFetch('https://worker/command', { method: 'POST', headers })).status).toBe(409);
  } finally { await worker.dispose(); }
});

it('acquires operator bindings and retains journal metadata across a local Worker restart', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createDeploymentWorker } from './worker.ts';
      export { CommandJournal, Sandbox } from './worker.ts';
      const deployment = createDeploymentWorker(async ({ persistNative, env }) => {
        if (env.CANONICAL_AUTHORITY !== 'operator-binding') throw new Error('Missing operator backend binding');
        await persistNative([{ sessionId: 'session', epoch: 'epoch', jobId: 'job' }],
          [{ jobId: 'job', receiptId: 'receipt', digest: 'digest' }]);
        return { fs: new MemoryFileSystem(), async close() {}, engine: {
          async execute(request) {
            await request.stdout.write(new Uint8Array([0, 128, 255]));
            return { exitCode: 0 };
          }
        } };
      });
      export default { async fetch(request, env, context) {
        // Model admission persisted immediately before an isolate disappears.
        // This fixture endpoint is never part of the deployment entrypoint.
        if (new URL(request.url).pathname === '/fixture/accept') {
          const journal = env.COMMAND_JOURNAL.get(env.COMMAND_JOURNAL.idFromName('alice'));
          await journal.accept('interrupted', {
            command: 'ffmpeg -version', state: 'accepted', stdoutOffset: '0', stderrOffset: '0',
            nativeJobs: [{ sessionId: 'session', epoch: 'epoch', jobId: 'interrupted-job' }],
          });
          return new Response(null, { status: 204 });
        }
        return deployment.fetch(request, env, context);
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], external: ['cloudflare:workers', 'node:*'],
    format: 'esm', bundle: true, write: false,
  });
  const configuration = {
    modules: true, script: bundle.outputFiles[0]!.text,
    bindings: { CANONICAL_AUTHORITY: 'operator-binding' },
    compatibilityDate: '2026-09-14', compatibilityFlags: ['nodejs_compat'],
    durableObjects: {
      COMMAND_JOURNAL: { className: 'CommandJournal', useSQLite: true },
      Sandbox: { className: 'Sandbox', useSQLite: true },
    },
    serviceBindings: { AUTHORIZATION: async request => Response.json({
      namespaceId: request.headers.get('Authorization') === 'Bearer alice' ? 'alice' : 'bob',
      expiresAt: Date.now() + 60000,
    }) },
  };
  const worker = new Miniflare(convertV4MiniflareOptions(configuration));
  const headers = { Authorization: 'Bearer alice', 'Idempotency-Key': 'retained', 'Shell-Command': 'ffmpeg -version' };
  try {
    const response = await worker.dispatchFetch('https://worker/command', { method: 'POST', headers });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 0, 0, 0, 3, 0, 128, 255])); // Fixed fixture only.
    expect((await worker.dispatchFetch('https://worker/fixture/accept')).status).toBe(204);
    // Miniflare retains SQLite while replacing Worker isolates. This does not
    // exercise container restart, canonical persistence or native execution.
    await worker.setOptions(convertV4MiniflareOptions({ ...configuration, script: bundle.outputFiles[0]!.text + '\n// replace Worker isolate\n' }));
    const status = await worker.dispatchFetch('https://worker/command/status', { headers });
    expect(await status.json()).toMatchObject({
      state: 'terminal', stdoutOffset: '3', stderrOffset: '0', exitCode: 0,
      nativeJobs: [{ sessionId: 'session', epoch: 'epoch', jobId: 'job' }],
      effectReceipts: [{ jobId: 'job', receiptId: 'receipt', digest: 'digest' }],
    });
    expect((await worker.dispatchFetch('https://worker/command', { method: 'POST', headers })).status).toBe(409);
    const interruptedHeaders = { ...headers, 'Idempotency-Key': 'interrupted' };
    const interrupted = await worker.dispatchFetch('https://worker/command/status', { headers: interruptedHeaders });
    expect(await interrupted.json()).toMatchObject({
      state: 'accepted', stdoutOffset: '0', stderrOffset: '0',
      nativeJobs: [{ sessionId: 'session', epoch: 'epoch', jobId: 'interrupted-job' }],
      recovery: 'inspect-native-job-and-effects; start-new-shell',
    });
    expect((await worker.dispatchFetch('https://worker/command', {
      method: 'POST', headers: interruptedHeaders,
    })).status).toBe(409);
    expect((await worker.dispatchFetch('https://worker/command/status', {
      headers: { ...headers, Authorization: 'Bearer bob' },
    })).status).toBe(404);
  } finally { await worker.dispose(); }
});

it('initializes the real Sandbox SDK and denies unavailable authorization in workerd', async () => {
  const bundle = await build({
    entryPoints: ['deploy/worker.ts'],
    absWorkingDir: new URL('..', import.meta.url).pathname,
    platform: 'browser', conditions: ['workerd'], external: ['cloudflare:workers', 'node:*'],
    format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-09-14', compatibilityFlags: ['nodejs_compat'],
    durableObjects: {
      COMMAND_JOURNAL: { className: 'CommandJournal', useSQLite: true },
      Sandbox: { className: 'Sandbox', useSQLite: true },
    },
    serviceBindings: { AUTHORIZATION: async request => {
      if (request.headers.get('Authorization') === 'Bearer oversized') {
        return Response.json({ namespaceId: 'caller', expiresAt: Date.now() + 60000, padding: 'x'.repeat(8192) });
      }
      if (request.headers.get('Authorization') === 'Bearer known') {
        return Response.json({ namespaceId: 'caller', expiresAt: Date.now() + 60000 });
      }
      throw new Error('Authorization unavailable');
    } },
  }));
  try {
    expect((await worker.dispatchFetch('https://worker/missing')).status).toBe(404);
    const denied = await worker.dispatchFetch('https://worker/command');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('Cache-Control')).toBe('no-store');
    expect((await worker.dispatchFetch('https://worker/v1/capabilities')).status).toBe(401);
    expect((await worker.dispatchFetch('https://worker/command/status', {
      headers: { Authorization: 'Bearer known', 'Idempotency-Key': 'unknown' },
    })).status).toBe(404);
    // Exercise the shipped default through the real SDK and journal bindings.
    // No qualified canonical lease exists, so no native job may be accepted.
    const gatedHeaders = {
      Authorization: 'Bearer known', 'Idempotency-Key': 'unconfigured',
      'Shell-Command': 'ffmpeg -version',
    };
    const gated = await worker.dispatchFetch('https://worker/command', {
      method: 'POST', headers: gatedHeaders,
    });
    expect(gated.status).toBe(503);
    expect(await gated.text()).toBe('Canonical runtime unavailable');
    const gatedStatus = await worker.dispatchFetch('https://worker/command/status', {
      headers: gatedHeaders,
    });
    expect(await gatedStatus.json()).toEqual({
      command: 'ffmpeg -version', state: 'recovery-required',
      stdoutOffset: '0', stderrOffset: '0',
      recovery: 'inspect-native-job-and-effects; start-new-shell',
    });
    expect((await worker.dispatchFetch('https://worker/command', {
      method: 'POST', headers: gatedHeaders,
    })).status).toBe(409);
    expect((await worker.dispatchFetch('https://worker/command/status', {
      headers: { Authorization: 'Bearer oversized', 'Idempotency-Key': 'unknown' },
    })).status).toBe(401);
    for (const path of ['/command', '/v1/capabilities']) {
      expect((await worker.dispatchFetch('https://worker' + path, {
        headers: { Authorization: 'Bearer valid' },
      })).status).toBe(401);
    }
  } finally { await worker.dispose(); }
});

it('executes binary shell pipes and explicit filesystem effects inside workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createWorkerShell } from './composition.ts';
      export default { async fetch() {
        const fs = new MemoryFileSystem();
        const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
        const shell = createWorkerShell({ fs, engine: { async execute(request) {
          if (request.command === 'ffmpeg') await request.stdout.write(bytes);
          else for await (const chunk of request.stdin) await request.stdout.write(chunk);
          return { exitCode: 0 };
        } } });
        try {
          const result = await shell.exec('ffmpeg -version | ffprobe -version > /result');
          return new Response(await fs.readFile('/result'), { headers: { 'Exit-Code': String(result.exitCode) } });
        } finally { await shell.dispose(); }
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14' }));
  try {
    const response = await worker.dispatchFetch('https://worker/');
    expect(response.headers.get('Exit-Code')).toBe('0');
    // Only this fixed 256-byte fixture is collected; production media streams.
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from({ length: 256 }, (_, i) => i));
  } finally { await worker.dispose(); }
});

it('streams authenticated commands and isolates caller admission identities in workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createMediaWorker } from './entrypoint.ts';
      const records = new Map();
      const filesystems = new Map();
      const media = createMediaWorker({
        async authenticate(request) {
          const token = request.headers.get('Authorization');
          return ['Bearer alice', 'Bearer bob'].includes(token)
            ? { namespaceId: token.slice(7), expiresAt: Date.now() + 60000 } : null;
        },
        driver: { async acquire(owner) {
          if (!['alice', 'bob'].includes(owner)) throw new Error('Untrusted owner');
          return { async fetch() { throw new Error('No Sandbox execution in this fixture'); } };
        } },
        journal: {
          async accept(owner, key, record) {
            const id = JSON.stringify([owner, key]);
            if (records.has(id)) return false;
            records.set(id, structuredClone(record)); return true;
          },
          async inspect(owner, key) { return records.get(JSON.stringify([owner, key])); },
          async put(owner, key, record) { records.set(JSON.stringify([owner, key]), structuredClone(record)); },
        },
        async runtime({ principal }) {
          let fs = filesystems.get(principal.namespaceId);
          if (!fs) { fs = new MemoryFileSystem(); filesystems.set(principal.namespaceId, fs); }
          return { fs, async close() {}, engine: { async execute(request) {
            for await (const bytes of request.stdin) await request.stdout.write(bytes);
            return { exitCode: 0 };
          } } };
        },
      });
      export default { fetch(request, env, context) { return media.fetch(request, context); } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14' }));
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const headers = (owner: string, command: string) => ({ Authorization: 'Bearer ' + owner, 'Idempotency-Key': 'same-key', 'Shell-Command': command, 'Namespace-Id': 'forged' });
  try {
    const response = await worker.dispatchFetch('https://worker/command', {
      method: 'POST', headers: headers('alice', 'ffmpeg -version | ffprobe -version > /result; ffprobe -version < /result'), body: bytes,
    });
    expect(response.status).toBe(200);
    const frame = new Uint8Array(await response.arrayBuffer()); // Fixed 256-byte fixture only.
    expect(frame[0]).toBe(1);
    expect(new DataView(frame.buffer).getUint32(1)).toBe(256);
    expect(frame.subarray(5)).toEqual(bytes);
    const status = await worker.dispatchFetch('https://worker/command/status', { headers: headers('alice', '') });
    expect(await status.json()).toMatchObject({ state: 'terminal', stdoutOffset: '256', exitCode: 0 });
    expect((await worker.dispatchFetch('https://worker/command', { method: 'POST', headers: headers('alice', 'ffmpeg -version') })).status).toBe(409);
    expect((await worker.dispatchFetch('https://worker/command/status', { headers: headers('bob', '') })).status).toBe(404);
    const isolated = await worker.dispatchFetch('https://worker/command', { method: 'POST', headers: headers('bob', 'ffprobe -version < /result') });
    expect(isolated.status).toBe(200);
    await isolated.arrayBuffer(); // Bounded missing-file diagnostic only.
    const isolatedStatus = await worker.dispatchFetch('https://worker/command/status', { headers: headers('bob', '') });
    expect(await isolatedStatus.json()).toMatchObject({ state: 'terminal', exitCode: 1 });
  } finally { await worker.dispose(); }
});

it('shares live command credits across request factories inside workerd', async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
      import { MemoryFileSystem } from 'virtual-bash';
      import { createMediaWorker } from './entrypoint.ts';
      export default { async fetch() {
        const records = new Map();
        const tasks = [];
        const context = { waitUntil(task) { tasks.push(task); } };
        const responses = [];
        let acquisitions = 0;
        const options = {
          async authenticate() { return { namespaceId: 'alice', expiresAt: Date.now() + 60000 }; },
          driver: { async acquire() { acquisitions++; return { async fetch() { throw new Error('fixture'); } }; } },
          journal: {
            async accept(owner, key, record) { records.set(key, record); return true; },
            async inspect(owner, key) { return records.get(key); },
            async put(owner, key, record) { records.set(key, record); },
          },
          async runtime() { return { fs: new MemoryFileSystem(), async close() {}, engine: {
            async execute(request) { await request.stdout.write(new Uint8Array([255])); return { exitCode: 0 }; }
          } }; },
        };
        const command = key => new Request('https://worker/command', {
          method: 'POST', headers: { 'Idempotency-Key': key, 'Shell-Command': 'ffmpeg -version' },
        });
        try {
          for (let i = 0; i < 4; i++) responses.push(await createMediaWorker(options).fetch(command(String(i)), context));
          const overflow = await createMediaWorker(options).fetch(command('overflow'), context);
          if (overflow.status === 200) responses.push(overflow);
          const before = acquisitions;
          await responses.shift().body.cancel('disconnect');
          await tasks[0];
          const replacement = await createMediaWorker(options).fetch(command('replacement'), context);
          if (replacement.status === 200) responses.push(replacement);
          return Response.json({ overflow: overflow.status, before, replacement: replacement.status,
            overflowAccepted: records.has('overflow') });
        } finally {
          await Promise.all(responses.map(response => response.body.cancel('retirement')));
          await Promise.all(tasks);
        }
      } };
    ` },
    platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false,
  });
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-09-14',
  }));
  try {
    expect(await (await worker.dispatchFetch('https://worker/')).json()).toEqual({
      overflow: 429, before: 4, replacement: 200, overflowAccepted: false,
    });
  } finally { await worker.dispose(); }
});
