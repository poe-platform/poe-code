import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import * as python from '../../../src/commands/python/index.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function context() {
  return { fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal };
}

async function assertPending(work: Promise<unknown>) {
  let settled = false;
  void work.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  assert.equal(settled, false, 'disposal must await admitted cooperative work');
}

function artifactCache() {
  const values = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    values, writes,
    async get(key: string) { return values.get(key)?.slice(); },
    async set(key: string, bytes: Uint8Array) {
      writes.push(key);
      values.set(key, bytes.slice());
    },
  };
}

test('host disposal drains an admitted manifest read and rejects new preparation and dispatch', { timeout: 2000 }, async () => {
  const entered = deferred<AbortSignal>();
  const release = deferred();
  const store = python.createPythonPackageManifestStore();
  const host = context();
  let reads = 0;
  let completed = false;
  let commits = 0;
  const environment = python.createPythonPackageEnvironment({ scope: 'review', manifestStore: {
    async get(scope, options) {
      reads++;
      entered.resolve(options.signal);
      try {
        await release.promise;
        return await store.get(scope, options);
      } finally { completed = true; }
    },
    async compareAndSet() { commits++; return true; },
  } });
  const preparation = assert.rejects(environment.prepare(host), /disposed/);
  try {
    const signal = await entered.promise;
    const disposal = environment.dispose();
    assert.equal(signal.aborted, true);
    assert.equal(host.signal.aborted, false);
    assert.equal(environment.dispose(), disposal);
    await assertPending(disposal);
    assert.equal(completed, false);
    await assert.rejects(environment.prepare(host), /disposed/);
    await assert.rejects(environment.dispatch('package-commit', ['late', ['late==1']], host), /disposed/);
    assert.equal(reads, 1);
    assert.equal(commits, 0);
    release.resolve();
    await Promise.all([preparation, disposal]);
    assert.equal(completed, true);
    assert.equal(environment.dispose(), disposal);
  } finally {
    release.resolve();
    await Promise.allSettled([preparation, environment.dispose()]);
    store.dispose();
  }
});

test('host disposal waits for a requirements read without publishing a prepared session', { timeout: 2000 }, async () => {
  const host = context();
  await host.fs.writeFile('/requirements.txt', new TextEncoder().encode('demo==1\n'));
  const readFile = host.fs.readFile.bind(host.fs);
  const entered = deferred<AbortSignal>();
  const release = deferred();
  let completed = false;
  let reads = 0;
  host.fs.readFile = async (path, options) => {
    reads++;
    assert.ok(options?.signal);
    entered.resolve(options.signal);
    try {
      await release.promise;
      options.signal.throwIfAborted();
      return await readFile(path, options);
    } finally { completed = true; }
  };
  const environment = python.createPythonPackageEnvironment({ requirementFiles: ['/requirements.txt', '/not-admitted.txt'] });
  const preparation = assert.rejects(environment.prepare(host), /disposed/);
  try {
    const signal = await entered.promise;
    const disposal = environment.dispose();
    await assertPending(disposal);
    assert.equal(signal.aborted, true);
    assert.equal(completed, false);
    release.resolve();
    await Promise.all([preparation, disposal]);
    assert.equal(completed, true);
    assert.equal(reads, 1);
    await assert.rejects(environment.prepare(host), /disposed/);
  } finally {
    release.resolve();
    await Promise.allSettled([preparation, environment.dispose()]);
  }
});

test('disposal closes admission before queued prepare or dispatch can acquire host resources', async () => {
  const host = context();
  let reads = 0;
  const environment = python.createPythonPackageEnvironment({ scope: 'review', manifestStore: {
    async get() { reads++; return undefined; },
    async compareAndSet() { throw new Error('commit must not be admitted'); },
  } });
  const preparation = assert.rejects(environment.prepare(host), /disposed/);
  const dispatch = assert.rejects(environment.dispatch('package-open', ['late', 'file:///late.whl'], host), /disposed/);
  const disposal = environment.dispose();
  await Promise.all([preparation, dispatch, disposal]);
  assert.equal(reads, 0);
  assert.equal(environment.dispose(), disposal);
});

test('host disposal drains a late transport response and its cleanup without caching it', { timeout: 2000 }, async () => {
  const entered = deferred<AbortSignal>();
  const releaseResponse = deferred();
  const disposingResponse = deferred();
  const releaseCleanup = deferred();
  const cache = artifactCache();
  const host = context();
  let pulls = 0;
  let disposals = 0;
  let completed = false;
  const environment = python.createPythonPackageEnvironment({ cache, authorize: () => true,
    transport: async request => {
      entered.resolve(request.signal);
      await releaseResponse.promise;
      return { status: 200, statusText: 'OK', headers: [],
        body: (async function* () { pulls++; yield new Uint8Array([1, 2, 3]); })(),
        async dispose() {
          disposals++;
          disposingResponse.resolve();
          await releaseCleanup.promise;
          completed = true;
        },
      };
    },
  });
  const start = await environment.prepare(host);
  const opening = assert.rejects(environment.dispatch('package-open', [start.session, 'https://review.invalid/late.whl'], host), /disposed/);
  try {
    const signal = await entered.promise;
    const disposal = environment.dispose();
    assert.equal(signal.aborted, true);
    await assertPending(disposal);
    releaseResponse.resolve();
    await disposingResponse.promise;
    assert.equal(environment.dispose(), disposal);
    await assertPending(disposal);
    assert.equal(pulls, 0);
    assert.equal(completed, false);
    releaseCleanup.resolve();
    await Promise.all([opening, disposal]);
    assert.equal(disposals, 1);
    assert.equal(completed, true);
    assert.deepEqual(cache.writes, []);
    environment.finish(start);
    environment.finish(start);
    await assert.rejects(environment.dispatch('package-commit', [start.session, ['late==1']], host), /disposed/);
  } finally {
    releaseResponse.resolve();
    releaseCleanup.resolve();
    await Promise.allSettled([opening, environment.dispose()]);
  }
});

test('host disposal drains an active download iterator and response cleanup before settling', { timeout: 2000 }, async () => {
  const reading = deferred<AbortSignal>();
  const releaseBody = deferred();
  const closingBody = deferred();
  const releaseBodyCleanup = deferred();
  const closingResponse = deferred();
  const releaseResponseCleanup = deferred();
  const cache = artifactCache();
  const progress: python.PythonPackageProgress[] = [];
  const host = context();
  let bodyClosed = false;
  let responseClosed = false;
  const environment = python.createPythonPackageEnvironment({ cache, authorize: () => true, onProgress: event => { progress.push(event); },
    transport: async request => ({ status: 200, statusText: 'OK', headers: [],
      body: (async function* () {
        try {
          reading.resolve(request.signal);
          await releaseBody.promise;
          yield new Uint8Array([4, 5, 6]);
        } finally {
          closingBody.resolve();
          await releaseBodyCleanup.promise;
          bodyClosed = true;
        }
      })(),
      async dispose() {
        closingResponse.resolve();
        await releaseResponseCleanup.promise;
        responseClosed = true;
      },
    }),
  });
  const start = await environment.prepare(host);
  const opening = assert.rejects(environment.dispatch('package-open', [start.session, 'https://review.invalid/body.whl'], host), /disposed/);
  try {
    const signal = await reading.promise;
    const disposal = environment.dispose();
    assert.equal(signal.aborted, true);
    await assertPending(disposal);
    releaseBody.resolve();
    await closingBody.promise;
    await assertPending(disposal);
    assert.equal(bodyClosed, false);
    releaseBodyCleanup.resolve();
    await closingResponse.promise;
    await assertPending(disposal);
    assert.equal(bodyClosed, true);
    assert.equal(responseClosed, false);
    releaseResponseCleanup.resolve();
    await Promise.all([opening, disposal]);
    assert.equal(responseClosed, true);
    assert.deepEqual(cache.writes, []);
    assert.deepEqual(progress, []);
  } finally {
    releaseBody.resolve();
    releaseBodyCleanup.resolve();
    releaseResponseCleanup.resolve();
    await Promise.allSettled([opening, environment.dispose()]);
  }
});

test('disposal drains an admitted cache write but never publishes its late URL metadata', { timeout: 2000 }, async () => {
  const host = context();
  await host.fs.writeFile('/demo.whl', new Uint8Array([7, 8, 9]));
  const entered = deferred();
  const release = deferred();
  const writes: string[] = [];
  const values = new Map<string, Uint8Array>();
  const environment = python.createPythonPackageEnvironment({ cache: {
    async get(key) { return values.get(key); },
    async set(key, bytes) {
      writes.push(key);
      entered.resolve();
      await release.promise;
      values.set(key, bytes.slice());
    },
  } });
  const start = await environment.prepare(host);
  const opening = assert.rejects(environment.dispatch('package-open', [start.session, 'file:///demo.whl'], host), /disposed/);
  try {
    await entered.promise;
    const disposal = environment.dispose();
    await assertPending(disposal);
    assert.equal(values.size, 0);
    release.resolve();
    await Promise.all([opening, disposal]);
    assert.equal(writes.length, 1);
    assert.ok(writes[0]!.includes('-sha256-'));
    assert.equal(values.size, 1);
    assert.equal([...values.keys()].some(key => key.includes('-url-')), false);
  } finally {
    release.resolve();
    await Promise.allSettled([opening, environment.dispose()]);
  }
});

test('host disposal drains a cooperative manifest commit and suppresses queued publication', { timeout: 2000 }, async () => {
  const entered = deferred<AbortSignal>();
  const release = deferred();
  const store = python.createPythonPackageManifestStore();
  const host = context();
  let key = '';
  let commits = 0;
  let completed = false;
  const progress: python.PythonPackageProgress[] = [];
  const environment = python.createPythonPackageEnvironment({ scope: 'review', onProgress: event => { progress.push(event); }, manifestStore: {
    get: store.get,
    async compareAndSet(scope, revision, bytes, options) {
      key = scope;
      commits++;
      entered.resolve(options.signal);
      try {
        await release.promise;
        return await store.compareAndSet(scope, revision, bytes, options);
      } finally { completed = true; }
    },
  } });
  const first = await environment.prepare(host);
  const second = await environment.prepare(host);
  const firstCommit = assert.rejects(environment.dispatch('package-commit', [first.session, ['first==1']], host), /disposed/);
  const secondCommit = assert.rejects(environment.dispatch('package-commit', [second.session, ['second==1']], host), /disposed/);
  try {
    const signal = await entered.promise;
    const disposal = environment.dispose();
    assert.equal(signal.aborted, true);
    await assertPending(disposal);
    assert.equal(completed, false);
    release.resolve();
    await Promise.all([firstCommit, secondCommit, disposal]);
    assert.equal(completed, true);
    assert.equal(commits, 1);
    assert.equal(await store.get(key, host), undefined);
    assert.deepEqual(progress, []);
    assert.equal(await store.compareAndSet(key, undefined, new TextEncoder().encode('[]'), host), true);
  } finally {
    release.resolve();
    await Promise.allSettled([firstCommit, secondCommit, environment.dispose()]);
    store.dispose();
  }
});

test('disposing one borrowing Shell drains only its download while its sibling can read and commit', { timeout: 3000 }, async () => {
  const host = context();
  const cache = artifactCache();
  const downloads = [0, 1].map(() => ({ entered: deferred<AbortSignal>(), release: deferred(), disposed: 0 }));
  const workers = [0, 1].map(() => {
    const started = deferred<python.PythonWorkerStart>();
    const worker = {
      started, terminated: 0, unsubscribed: 0,
      send(_message: unknown): void { throw new Error('worker has not subscribed'); },
      endpoint: undefined as python.PythonWorkerEndpoint | undefined,
    };
    worker.endpoint = {
      subscribe(listener) { worker.send = listener; return () => { worker.unsubscribed++; }; },
      postMessage(message) { started.resolve(message as python.PythonWorkerStart); },
      terminate() { worker.terminated++; },
    };
    return worker;
  });
  let requests = 0;
  const environment = python.createPythonPackageEnvironment({ cache, authorize: () => true,
    transport: async request => {
      const download = downloads[request.url.endsWith('/first.whl') ? 0 : 1]!;
      requests++;
      return { status: 200, statusText: 'OK', headers: [],
        body: (async function* () {
          download.entered.resolve(request.signal);
          await download.release.promise;
          request.signal.throwIfAborted();
          yield new Uint8Array([10, 11, 12]);
        })(),
        async dispose() { download.disposed++; },
      };
    },
  });
  const first = new Shell({ fs: host.fs }).use(python.pythonCommands({ environment, createWorker: () => workers[0]!.endpoint! }));
  const sibling = new Shell({ fs: host.fs }).use(python.pythonCommands({ environment, createWorker: () => workers[1]!.endpoint! }));
  const firstRun = assert.rejects(first.exec('python -c pass'), /disposed/);
  const siblingRun = sibling.exec('python -c pass');
  void siblingRun.catch(() => {});
  try {
    const [firstStart, siblingStart] = await Promise.all(workers.map(worker => worker.started.promise));
    workers[0]!.send({ op: 'package-open', args: [firstStart!.packages!.session, 'https://review.invalid/first.whl'] });
    workers[1]!.send({ op: 'package-open', args: [siblingStart!.packages!.session, 'https://review.invalid/sibling.whl'] });
    const [firstSignal, siblingSignal] = await Promise.all(downloads.map(download => download.entered.promise));
    const disposal = first.dispose();
    assert.equal(first.dispose(), disposal);
    await assertPending(disposal);
    assert.equal(firstSignal!.aborted, true);
    assert.equal(siblingSignal!.aborted, false);
    assert.equal(host.signal.aborted, false);
    downloads[0]!.release.resolve();
    await Promise.all([firstRun, disposal]);
    await assertPending(siblingRun);
    assert.equal(downloads[0]!.disposed, 1);
    assert.equal(downloads[1]!.disposed, 0);
    assert.equal(workers[0]!.terminated, 1);
    assert.equal(workers[0]!.unsubscribed, 1);
    assert.equal(workers[1]!.terminated, 0);
    assert.equal(siblingSignal!.aborted, false);
    assert.deepEqual(cache.writes, []);
    await assert.rejects(environment.dispatch('package-commit', [firstStart!.packages!.session, ['retired==1']], host), /closed/);

    downloads[1]!.release.resolve();
    await nextTurn();
    const control = new Int32Array(siblingStart!.shared, 0, 2);
    assert.equal(Atomics.load(control, 0), 1);
    const opened = JSON.parse(new TextDecoder().decode(new Uint8Array(siblingStart!.shared, 8, Atomics.load(control, 1)))) as { key: string; size: number };
    assert.equal(opened.size, 3);
    Atomics.store(control, 0, 0);
    workers[1]!.send({ op: 'package-read', args: [siblingStart!.packages!.session, opened.key, 0, 3] });
    await nextTurn();
    assert.equal(Atomics.load(control, 0), 1);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(new Uint8Array(siblingStart!.shared, 8, Atomics.load(control, 1)))), [10, 11, 12]);
    Atomics.store(control, 0, 0);
    workers[1]!.send({ op: 'package-commit', args: [siblingStart!.packages!.session, ['sibling==1']] });
    await nextTurn();
    assert.equal(Atomics.load(control, 0), 1);
    workers[1]!.send({ type: 'exit', exitCode: 0 });
    assert.equal((await siblingRun).exitCode, 0);
    await sibling.dispose();
    await sibling.dispose();
    assert.equal(workers[1]!.terminated, 1);
    assert.equal(downloads[1]!.disposed, 1);
    const next = await environment.prepare({ ...host, offline: true });
    assert.deepEqual(next.requirements, ['sibling==1']);
    assert.deepEqual(await environment.dispatch('package-open', [next.session, 'https://review.invalid/sibling.whl'], host), opened);
    assert.equal(requests, 2);
    environment.finish(next);
  } finally {
    for (const download of downloads) download.release.resolve();
    await Promise.allSettled([first.dispose(), sibling.dispose(), firstRun, siblingRun]);
    await environment.dispose();
  }
});
