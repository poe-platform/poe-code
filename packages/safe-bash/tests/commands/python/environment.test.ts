import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import * as python from '../../../src/commands/python/index.js';

function context() { return { fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal }; }
const bytes = (value: string) => new TextEncoder().encode(value);

test('package environment ownership does not hide missing executor diagnostics', () => {
  assert.throws(() => python.pythonCommands(undefined as never), { category: 'executor-unavailable' });
  assert.throws(() => python.pythonCommands({} as never), { category: 'executor-unavailable' });
});

test('shared manifest stores reject stale commits across independent environments', async () => {
  const manifestStore = python.createPythonPackageManifestStore();
  const first = python.createPythonPackageEnvironment({ manifestStore, scope: 'tenant' });
  const second = python.createPythonPackageEnvironment({ manifestStore, scope: 'tenant' });
  const host = context();
  const starts = await Promise.all([first.prepare(host), second.prepare(host)]);
  const commits = await Promise.allSettled([
    first.dispatch('package-commit', [starts[0]!.session, ['one==1']], host),
    second.dispatch('package-commit', [starts[1]!.session, ['two==2']], host),
  ]);
  assert.equal(commits.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = commits.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof python.PythonPackageConflictError);
  assert.equal(rejected.reason.retryable, true);
  first.finish(starts[0]!); second.finish(starts[1]!);
  const retry = await second.prepare({ ...host, requirements: ['two==2'] });
  assert.deepEqual(retry.requirements, ['one==1', 'two==2']);
  await second.dispatch('package-commit', [retry.session, retry.requirements], host);
  second.finish(retry);
  await first.dispose(); await second.dispose();
  const next = python.createPythonPackageEnvironment({ manifestStore, scope: 'tenant' });
  const observed = await next.prepare(host);
  assert.deepEqual(observed.requirements, ['one==1', 'two==2']);
  next.finish(observed); await next.dispose(); manifestStore.dispose();
});

test('artifact cache sharing never imports another environment manifest implicitly', async () => {
  const values = new Map<string, Uint8Array>();
  const cache = { async get(key: string) { return values.get(key)?.slice(); }, async set(key: string, value: Uint8Array) { values.set(key, value.slice()); } };
  const host = context();
  const first = python.createPythonPackageEnvironment({ cache });
  const initial = await first.prepare(host);
  await first.dispatch('package-commit', [initial.session, ['tenant-secret==1']], host);
  first.finish(initial);
  const second = python.createPythonPackageEnvironment({ cache });
  const fresh = await second.prepare(host);
  assert.deepEqual(fresh.requirements, []);
  assert.equal([...values.keys()].some(key => key.includes('environment')), false);
  second.finish(fresh); await first.dispose(); await second.dispose();
});

test('manifest scopes are explicit and isolate requirements while sharing artifact bytes', async () => {
  const manifestStore = python.createPythonPackageManifestStore();
  const cache = python.createPythonPackageCache({ maxBytes: 1024 });
  assert.throws(() => python.createPythonPackageEnvironment({ manifestStore }), /scope/);
  assert.throws(() => python.createPythonPackageEnvironment({ manifestStore, scope: '' }), /scope/);
  let downloads = 0;
  const first = python.createPythonPackageEnvironment({ manifestStore, scope: 'first', cache,
    authorize: () => true, transport: async () => {
      downloads++;
      return { status: 200, statusText: 'OK', headers: [], body: (async function*() { yield bytes('shared wheel'); })(), async dispose() {} };
    },
  });
  const second = python.createPythonPackageEnvironment({ manifestStore, scope: 'second', cache, offline: true });
  const host = context();
  const initial = await first.prepare(host);
  await first.dispatch('package-open', [initial.session, 'https://example.test/shared.whl'], host);
  await first.dispatch('package-commit', [initial.session, ['private==1']], host);
  first.finish(initial);
  const fresh = await second.prepare(host);
  assert.deepEqual(fresh.requirements, []);
  const shared = await second.dispatch('package-open', [fresh.session, 'https://example.test/shared.whl'], host) as { key: string };
  assert.deepEqual(await second.dispatch('package-read', [fresh.session, shared.key, 0, 64], host), Array.from(bytes('shared wheel')));
  assert.equal(downloads, 1);
  second.finish(fresh); await first.dispose(); await second.dispose(); manifestStore.dispose(); cache.dispose();
});

test('fresh shells borrow an environment without disposing it or losing installed pins', async () => {
  const environment = python.createPythonPackageEnvironment();
  const host = context();
  const prepared = await environment.prepare(host);
  await environment.dispatch('package-commit', [prepared.session, ['demo==1']], host);
  environment.finish(prepared);
  const requirements: string[][] = [];
  for (let invocation = 0; invocation < 2; invocation++) {
    const shell = new Shell({ fs: host.fs }).use(python.pythonCommands({ environment,
      createWorker() {
        let send!: (value: unknown) => void;
        return { subscribe(listener) { send = listener; return () => {}; },
          postMessage(message) { requirements.push([...(message as python.PythonWorkerStart).packages!.requirements]); send({ type: 'exit', exitCode: 0 }); },
          terminate() {} };
      },
    }));
    assert.equal((await shell.exec('python -c pass')).exitCode, 0);
    await shell.dispose(); await shell.dispose();
  }
  assert.deepEqual(requirements, [['demo==1'], ['demo==1']]);
  await environment.dispose(); await environment.dispose();
  await assert.rejects(environment.prepare(host), /disposed/);
});

test('manifest stores own bytes, enforce CAS revisions and reject writes beyond their budget', async () => {
  const store = python.createPythonPackageManifestStore({ maxBytes: 16 });
  const host = { signal: new AbortController().signal };
  const original = bytes('["one==1"]');
  assert.equal(await store.compareAndSet('tenant', undefined, original, host), true);
  original.fill(0);
  const snapshot = (await store.get('tenant', host))!;
  assert.deepEqual(snapshot.bytes, bytes('["one==1"]'));
  snapshot.bytes.fill(0);
  assert.equal(await store.compareAndSet('tenant', undefined, bytes('[]'), host), false);
  await assert.rejects(store.compareAndSet('tenant', snapshot.revision, bytes('x'.repeat(17)), host), /budget/);
  assert.deepEqual((await store.get('tenant', host))!.bytes, bytes('["one==1"]'));
  store.dispose(); store.dispose();
  await assert.rejects(store.get('tenant', host), /disposed/);
});

test('shared artifact cache owns bytes, enforces its payload budget and has an explicit lifetime', async () => {
  const cache = python.createPythonPackageCache({ maxBytes: 8 });
  const first = bytes('first');
  await cache.set('first', first);
  first.fill(0);
  const read = (await cache.get('first'))!;
  assert.deepEqual(read, bytes('first'));
  read.fill(0);
  await cache.set('second', bytes('next'));
  assert.equal(await cache.get('first'), undefined);
  assert.deepEqual(await cache.get('second'), bytes('next'));
  await cache.set('too-large', bytes('more than eight bytes'));
  assert.equal(await cache.get('too-large'), undefined);
  cache.dispose(); cache.dispose();
  await assert.rejects(cache.get('second'), /disposed/);
  await assert.rejects(cache.set('third', bytes('x')), /disposed/);
  assert.throws(() => python.createPythonPackageCache({ maxBytes: 0 }), /positive integer/);
});

test('canonical wheel URLs are resolved in each invocation filesystem rather than a shared URL cache', async () => {
  const cache = python.createPythonPackageCache();
  const environment = python.createPythonPackageEnvironment({ cache });
  for (const value of ['tenant-one', 'tenant-two', 'updated-wheel']) {
    const host = context();
    await host.fs.writeFile('/package.whl', bytes(value));
    const start = await environment.prepare(host);
    const opened = await environment.dispatch('package-open', [start.session, 'file:///package.whl'], host) as { key: string };
    assert.deepEqual(await environment.dispatch('package-read', [start.session, opened.key, 0, 128], host), Array.from(bytes(value)));
    environment.finish(start);
  }
  await environment.dispose(); cache.dispose();
});

test('malformed shared manifest snapshots cannot be mistaken for absent environments', async () => {
  for (const snapshot of [null, false, '', { revision: '', bytes: bytes('[]') }, { revision: '1', bytes: [] }]) {
    const environment = python.createPythonPackageEnvironment({ scope: 'tenant', manifestStore: {
      async get() { return snapshot as never; }, async compareAndSet() { throw new Error('must not publish'); },
    } });
    await assert.rejects(environment.prepare(context()), /Invalid Python package manifest snapshot/);
    await environment.dispose();
  }
});

test('conditional manifest publication requires an explicit boolean acknowledgement', async () => {
  const environment = python.createPythonPackageEnvironment({ scope: 'tenant', manifestStore: {
    async get() { return undefined; }, async compareAndSet() { return 'not a receipt' as never; },
  } });
  const host = context();
  const start = await environment.prepare(host);
  await assert.rejects(environment.dispatch('package-commit', [start.session, ['one==1']], host), /Invalid Python package manifest publication/);
  environment.finish(start); await environment.dispose();
});

test('caller cancellation takes precedence over late invalid snapshots or conflict replies', async () => {
  for (const phase of ['read', 'commit']) {
    const controller = new AbortController();
    const reason = new Error('caller cancelled manifest operation');
    const environment = python.createPythonPackageEnvironment({ scope: 'tenant', manifestStore: {
      async get() { if (phase === 'read') { controller.abort(reason); return null as never; } return undefined; },
      async compareAndSet() { controller.abort(reason); return false; },
    } });
    const host = { ...context(), signal: controller.signal };
    if (phase === 'read') await assert.rejects(environment.prepare(host), error => error === reason);
    else {
      const start = await environment.prepare(host);
      await assert.rejects(environment.dispatch('package-commit', [start.session, ['one==1']], host), error => error === reason);
      environment.finish(start);
    }
    await environment.dispose();
  }
});

test('shared manifest read failures have sanitized asset diagnostics and retain private host details', async () => {
  const cause = new Error('https://user:password@example.test/state?token=secret');
  const diagnostics: python.PythonDiagnostic[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
    createWorker() { throw new Error('must not start an interpreter'); },
    provisioning: { scope: 'tenant', manifestStore: {
      async get() { throw cause; }, async compareAndSet() { return false; },
    } },
    onDiagnostic(event) { diagnostics.push(event); },
  }));
  try {
    const result = await shell.exec('python -c pass');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Python runtime or package assets/);
    assert.doesNotMatch(result.stderr, /internal error|password|token=secret/);
    assert.equal((diagnostics[0]?.cause as Error).cause, cause);
  } finally { await shell.dispose(); }
});

test('distinct host scope strings cannot alias through lossy UTF-8 encoding', async () => {
  const manifestStore = python.createPythonPackageManifestStore();
  const first = python.createPythonPackageEnvironment({ manifestStore, scope: 'tenant-\ud800' });
  const second = python.createPythonPackageEnvironment({ manifestStore, scope: 'tenant-\ud801' });
  const host = context();
  const installed = await first.prepare(host);
  await first.dispatch('package-commit', [installed.session, ['private==1']], host);
  first.finish(installed);
  const fresh = await second.prepare(host);
  assert.deepEqual(fresh.requirements, []);
  second.finish(fresh); await first.dispose(); await second.dispose(); manifestStore.dispose();
});
