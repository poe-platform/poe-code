import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightCli, type PlaywrightControllerOptions, type PlaywrightLease, type PlaywrightPage, type PlaywrightSessionPersistence } from '../../src/commands/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

function fixture(overrides: Partial<PlaywrightControllerOptions> = {}) {
  let releases = 0;
  let allocations = 0;
  let restores = 0;
  const navigations: string[] = [];
  const pages = ['first', 'selected'].map(name => ({
    url: () => `https://example.test/${name}`,
    async goto(url: string) { navigations.push(`${name}:${url}`); }, on() {}, off() {},
  } as unknown as PlaywrightPage)) as [PlaywrightPage, PlaywrightPage];
  const lease: PlaywrightLease = {
    context: { pages: () => pages, async newPage() { allocations++; return pages[0]!; }, async close() {}, on() {}, off() {} },
    onClosed: () => () => {}, async release() { releases++; },
  };
  const options = { namedSessionAttachment: true, adapter: {
    browsers: { chromium: { headed: false } }, async acquire() { allocations++; return lease; },
  }, persistence: {
    async list() { return [{ name: 'saved' }]; },
    async restore({ name }: { name: string }) { restores++; return name === 'saved' ? { lease, selectedPage: pages[1] } : undefined; },
    async checkpoint() {}, async delete() {}, async close() {},
  }, ...overrides };
  const cli = createPlaywrightCli(options);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use(cli.plugin);
  const run = (args: string, signal?: AbortSignal) => shell.exec(`playwright-cli ${args}`, signal ? { signal } : undefined);
  return { cli, shell, run, lease, pages, navigations, get releases() { return releases; }, get allocations() { return allocations; }, get restores() { return restores; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('snapshot ref budgets do not limit persisted session listing or attachment', async () => {
  const f = fixture({ limits: { maxSnapshotRefs: 1, maxSessions: 1 }, persistence: {
    async list() { return [{ name: 'saved' }, { name: 'other' }]; },
    async restore() { return { lease: f.lease, selectedPage: f.pages[1] }; },
    async checkpoint() {}, async delete() {}, async close() {},
  } });
  try {
    const listed = await f.run('list');
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.match(listed.stdout, /saved/);
    assert.match(listed.stdout, /other/);
    assert.equal((await f.run('attach saved')).exitCode, 0);
    assert.equal((await f.run('close-all')).exitCode, 0);
    assert.equal(f.releases, 1);
  } finally { await f.shell.dispose(); }
});

test('closed and expired metadata cannot allocate a browser during attachment', async () => {
  let calls = 0;
  const f = fixture({ persistence: {
    async list() { return [{ name: 'expired', expiresAt: Date.now() - 1 }]; },
    async restore() { calls++; throw new Error('must not allocate'); },
    async checkpoint() {}, async close() {}, async delete() {},
  } });
  try {
    assert.equal((await f.run('attach expired')).exitCode, 1);
    assert.equal((await f.run('attach closed')).exitCode, 1);
    assert.equal(calls, 0);
  } finally { await f.shell.dispose(); }
});

test('saved metadata listing is independent of snapshot refs and live capacity', async () => {
  const f = fixture({ limits: { maxSnapshotRefs: 1, maxSessions: 1 }, persistence: {
    async list() { return [{ name: 'saved' }, { name: 'other' }]; },
    async restore() { return { lease: f.lease, selectedPage: f.pages[1] }; },
    async checkpoint() {}, async delete() {},
  } });
  try {
    const listed = await f.run('list');
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.ok(listed.stdout.includes('saved'));
    assert.ok(listed.stdout.includes('other'));
    assert.equal((await f.run('attach saved')).exitCode, 0);
    assert.equal((await f.run('attach other')).exitCode, 1);
    assert.equal((await f.run('close-all')).exitCode, 0);
    assert.equal(f.releases, 1);
  } finally { await f.shell.dispose(); }
});

test('saved metadata still validates every entry beyond the snapshot ref budget', async () => {
  for (const entry of [{ name: '../invalid' }, { name: 'other', expiresAt: -1 }]) {
    const f = fixture({ limits: { maxSnapshotRefs: 1 }, persistence: {
      async list() { return [{ name: 'saved' }, entry]; },
      async restore() { throw new Error('must not allocate'); }, async checkpoint() {}, async delete() {},
    } });
    try {
      const result = await f.run('list');
      assert.equal(result.exitCode, 1);
      assert.match(result.stdout + result.stderr, /Invalid (session name|persisted session expiry)/);
      assert.ok(!result.stdout.includes('### Browsers'));
      assert.equal(f.allocations, 0);
    } finally { await f.shell.dispose(); }
  }
});

test('saved metadata listing still obeys the command output budget', async () => {
  const f = fixture({ limits: { maxSnapshotRefs: 1, maxCommandBytes: 32 }, persistence: {
    async list() { return [{ name: 'saved' }, { name: 'other' }]; },
    async restore() { throw new Error('must not allocate'); }, async checkpoint() {}, async delete() {},
  } });
  try {
    const result = await f.run('list');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit/i);
    assert.equal(result.stdout, '');
    assert.equal(f.allocations, 0);
  } finally { await f.shell.dispose(); }
});

test('capacity includes pending restoration and prevents a second host allocation', async () => {
  const admitted = deferred<void>();
  const gate = deferred<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>>();
  const calls: string[] = [];
  const f = fixture({ limits: { maxSessions: 1 }, persistence: {
    async list() { return [{ name: 'saved' }, { name: 'other' }]; },
    async restore({ name }) { if (!['saved', 'other'].includes(name)) return undefined; calls.push(name); admitted.resolve(); return gate.promise; },
    async checkpoint() {}, async delete() {},
  } });
  try {
    const first = f.run('attach saved');
    await admitted.promise;
    const second = await f.run('attach other');
    // A queued close must follow the same admission without releasing twice.
    const closing = f.run('-s=saved close');
    gate.resolve({ lease: f.lease, selectedPage: f.pages[1] });
    assert.equal((await first).exitCode, 0);
    assert.equal(second.exitCode, 1);
    assert.equal((await closing).exitCode, 0);
    assert.deepEqual(calls, ['saved']);
    assert.equal(f.releases, 1);
    assert.deepEqual(f.cli.inspectSessions(), []);
    assert.equal((await f.run('goto https://example.test/closed')).exitCode, 1);
  } finally { await f.shell.dispose(); }
});

test('concurrent attachment to one alias restores once and close prevents later attachment', async () => {
  const f = fixture();
  try {
    const results = await Promise.all([f.run('attach saved'), f.run('attach saved')]);
    assert.deepEqual(results.map(result => result.exitCode), [0, 0]);
    assert.equal(f.restores, 1);
    assert.equal(f.cli.inspectSessions().length, 1);
    const [closed, attached] = await Promise.all([f.run('-s=saved close'), f.run('attach saved')]);
    assert.equal(closed.exitCode, 0);
    assert.equal(attached.exitCode, 1);
    assert.equal(f.releases, 1);
  } finally { await f.shell.dispose(); }
});

test('cancelled restoration retires a late lease without publishing attachment', async () => {
  const admitted = deferred<void>();
  const gate = deferred<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>>();
  const f = fixture({ persistence: {
    async restore({ name }) { if (name !== 'saved') return undefined; admitted.resolve(); return gate.promise; }, async checkpoint() {}, async delete() {},
  } });
  const cancellation = new AbortController();
  try {
    const attaching = f.run('attach saved', cancellation.signal);
    await admitted.promise;
    cancellation.abort(new Error('cancel attachment'));
    gate.resolve({ lease: f.lease, selectedPage: f.pages[1] });
    await assert.rejects(attaching, /cancel attachment/);
    assert.equal(f.releases, 1);
    assert.deepEqual(f.cli.inspectSessions(), []);
    assert.equal((await f.run('goto https://example.test/unselected')).exitCode, 1);
  } finally { await f.shell.dispose(); }
});

test('a host cannot give two controller names ownership of the same lease', async () => {
  const f = fixture();
  try {
    await f.cli.restoreSession({ name: 'live', acquire: async () => ({ lease: f.lease, selectedPage: f.pages[1] }) });
    assert.equal((await f.run('attach saved')).exitCode, 1);
    assert.equal(f.releases, 0);
    assert.deepEqual(f.cli.inspectSessions().map(session => session.name), ['live']);
    assert.equal((await f.run('-s=live tab-list')).exitCode, 0);
  } finally { await f.shell.dispose(); }
  assert.equal(f.releases, 1);
});

test('public attach reuses the owned live lease, selection and state across shell invocations', async () => {
  const f = fixture();
  try {
    await f.cli.restoreSession({ name: 'live', acquire: async () => ({ lease: f.lease, selectedPage: f.pages[1] }) });
    assert.equal((await f.run('attach live')).exitCode, 0);
    assert.equal((await f.run('goto https://example.test/retained')).exitCode, 0);
    assert.deepEqual(f.navigations, ['selected:https://example.test/retained']);
    assert.equal(f.restores, 0);
    assert.equal(f.allocations, 0);
    assert.equal(f.cli.inspectSessions().length, 1);
    assert.equal(f.cli.inspectSessions()[0]!.context, f.lease.context);
    assert.equal(f.cli.inspectSessions()[0]!.selectedPage, f.pages[1]);
    assert.equal((await f.run('-s=default goto https://example.test/absent')).exitCode, 1);
    assert.equal((await f.run('-s=live tab-list')).exitCode, 0);
    assert.equal((await f.run('detach --json')).exitCode, 0);
    assert.equal(f.releases, 0);
    assert.equal((await f.run('goto https://example.test/detached')).exitCode, 1);
    assert.equal((await f.run('-s=live goto https://example.test/explicit')).exitCode, 0);
    assert.equal((await f.run('-s=live attach live')).exitCode, 0);
    assert.equal((await f.run('close')).exitCode, 0);
    assert.equal(f.releases, 1);
    assert.equal((await f.run('attach live')).exitCode, 1);
  } finally { await f.shell.dispose(); }
  assert.equal(f.releases, 1);
});

test('attachment routes distinct shell calls with a consistent authenticated environment default', async () => {
  const f = fixture();
  const env = { PLAYWRIGHT_CLI_SESSION: 'authenticated-agent' };
  const run = (args: string) => f.shell.exec(`playwright-cli ${args}`, { env });
  try {
    const attached = await run('attach saved');
    assert.equal(attached.exitCode, 0, attached.stderr);
    assert.equal((await run('goto https://example.test/owner-default')).exitCode, 0);
    assert.deepEqual(f.navigations, ['selected:https://example.test/owner-default']);
    assert.deepEqual(f.cli.inspectSessions().map(session => session.name), ['saved']);
    assert.equal((await run('-s=authenticated-agent goto https://example.test/explicit')).exitCode, 1);
    assert.equal((await run('-s=saved tab-list')).exitCode, 0);
    assert.equal((await run('detach')).exitCode, 0);
    assert.equal(f.releases, 0);
    assert.equal((await run('goto https://example.test/detached')).exitCode, 1);
    assert.equal((await run('-s=saved attach saved')).exitCode, 0);
    assert.equal((await run('close')).exitCode, 0);
    assert.equal(f.releases, 1);
  } finally { await f.shell.dispose(); }
});

test('attachment restores only a committed owned profile and advertises the host capability', async () => {
  const f = fixture();
  try {
    assert.match((await f.run('attach --help')).stdout, /attach: supported.*named/);
    assert.equal(f.restores, 0);
    const result = await f.run('attach saved --json');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { session: 'saved', status: 'attached' });
    assert.equal(f.restores, 1);
    assert.equal(f.allocations, 0);
    assert.equal((await f.run('goto https://example.test/resumed')).exitCode, 0);
    assert.deepEqual(f.navigations, ['selected:https://example.test/resumed']);
    assert.equal((await f.run('attach saved')).exitCode, 0);
    assert.equal(f.restores, 1);
    assert.equal((await f.run('-s=saved detach')).exitCode, 0);
    assert.equal(f.releases, 0);
    assert.equal((await f.run('-s=saved close')).exitCode, 0);
    assert.equal((await f.run('attach saved')).exitCode, 1);
    assert.equal(f.restores, 1);
  } finally { await f.shell.dispose(); }
});

test('invalid and unsupported attachment forms fail before persistence or browser I/O', async () => {
  const f = fixture();
  try {
    for (const args of ['attach', 'attach https://private.test', 'attach --cdp=https://private.test', 'attach --endpoint=wss://private.test', 'attach --extension', 'attach saved --config=config.json', 'attach saved --idle-timeout=100', '-s=other attach saved']) {
      assert.equal((await f.run(args)).exitCode, 1, args);
    }
    assert.equal(f.restores, 0);
    assert.equal(f.allocations, 0);
    assert.equal((await f.run('attach missing')).exitCode, 1);
    assert.deepEqual(f.cli.inspectSessions(), []);
  } finally { await f.shell.dispose(); }
});

test('owners with identical aliases retain independent state and lease lifecycles', async () => {
  const alice = fixture();
  const bob = fixture();
  try {
    assert.equal((await alice.run('attach saved')).exitCode, 0);
    assert.equal((await bob.run('attach saved')).exitCode, 0);
    await alice.run('goto https://example.test/alice');
    await bob.run('goto https://example.test/bob');
    assert.deepEqual(alice.navigations, ['selected:https://example.test/alice']);
    assert.deepEqual(bob.navigations, ['selected:https://example.test/bob']);
    await alice.run('close-all');
    assert.equal(alice.releases, 1);
    assert.equal(bob.releases, 0);
    assert.equal((await bob.run('tab-list')).exitCode, 0);
  } finally { await alice.shell.dispose(); await bob.shell.dispose(); }
});

test('close-all clears selection established by an attachment already awaiting restoration', async () => {
  const admitted = deferred<void>();
  const closingListed = deferred<void>();
  const gate = deferred<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>>();
  let lists = 0;
  const f = fixture({ persistence: {
    async list() {
      if (++lists === 2) closingListed.resolve();
      return [{ name: 'saved' }];
    },
    async restore({ name }) {
      if (name !== 'saved') return undefined;
      admitted.resolve();
      return gate.promise;
    },
    async checkpoint() {}, async delete() {}, async close() {},
  } });
  try {
    const attaching = f.run('attach saved');
    await admitted.promise;
    const closing = f.run('close-all');
    await closingListed.promise;
    // Let close-all reserve its retirement behind the admitted attachment.
    await new Promise<void>(resolve => setImmediate(resolve));
    gate.resolve({ lease: f.lease, selectedPage: f.pages[1] });
    assert.equal((await attaching).exitCode, 0);
    assert.equal((await closing).exitCode, 0);
    assert.equal(f.releases, 1);
    assert.deepEqual(f.cli.inspectSessions(), []);
    assert.deepEqual(JSON.parse((await f.run('detach --json')).stdout), { session: 'default', status: 'not-attached' });
  } finally { await f.shell.dispose(); }
});

test('changing the environment default bypasses attachment without changing the selected alias', async () => {
  const f = fixture();
  try {
    assert.equal((await f.run('attach saved')).exitCode, 0);
    const explicit = await f.shell.exec('PLAYWRIGHT_CLI_SESSION=missing playwright-cli tab-list');
    assert.equal(explicit.exitCode, 1);
    assert.equal((await f.run('goto https://example.test/after-explicit')).exitCode, 0);
    assert.deepEqual(f.navigations, ['selected:https://example.test/after-explicit']);
    assert.equal((await f.shell.exec('PLAYWRIGHT_CLI_SESSION=missing playwright-cli attach saved')).exitCode, 0);
    assert.equal((await f.shell.exec('PLAYWRIGHT_CLI_SESSION=missing playwright-cli tab-list')).exitCode, 0);
    assert.equal((await f.run('goto https://example.test/old-default')).exitCode, 1);
    assert.equal(f.releases, 0);
  } finally { await f.shell.dispose(); }
});

test('disposal waits for a pending attachment lease to arrive and retire', async () => {
  const admitted = deferred<void>();
  const gate = deferred<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>>();
  const f = fixture({ persistence: {
    async restore({ name }) {
      if (name !== 'saved') return undefined;
      admitted.resolve();
      return gate.promise;
    },
    async checkpoint() {}, async delete() {},
  } });
  try {
    const attaching = f.run('attach saved');
    await admitted.promise;
    let disposed = false;
    const disposal = f.cli.dispose().then(() => { disposed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(disposed, false);
    gate.resolve({ lease: f.lease, selectedPage: f.pages[1] });
    assert.equal((await attaching).exitCode, 1);
    await disposal;
    assert.equal(f.releases, 1);
    assert.deepEqual(f.cli.inspectSessions(), []);
  } finally { await f.shell.dispose(); }
});
