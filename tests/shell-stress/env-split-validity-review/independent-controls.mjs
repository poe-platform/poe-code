import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { relative, resolve } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const group = process.argv[2];
assert.ok(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].includes(group));
const packageRoot = realpathSync(process.env.CONSUMER_PACKAGE_ROOT);
const loaded = {};
const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbidden.push(name); throw new Error('Product native process denied'); };
globalThis.fetch = async () => { forbidden.push('fetch'); throw new Error('Product network denied'); };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const filename = realpathSync(fileURLToPath(url));
    assert.ok(filename.startsWith(resolve(packageRoot, 'dist') + '/') && filename.endsWith('.js'));
    loaded[relative(packageRoot, filename)] = createHash('sha256').update(readFileSync(filename)).digest('hex');
  }
  return nextLoad(url, context);
} });
const resolved = { root: import.meta.resolve('virtual-bash'), contracts: import.meta.resolve('virtual-bash/contracts') };
assert.equal(resolved.root, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
assert.equal(resolved.contracts, pathToFileURL(resolve(packageRoot, 'dist/contracts/index.js')).href);
const api = await import('virtual-bash');
const contracts = await import('virtual-bash/contracts');
assert.equal(api.FsError, contracts.FsError);
const { Shell, MemoryFileSystem, agentCommands, ShellLimitError } = api;
const observations = [];
const snapshots = context => ({ command: context.command, args: [...context.args], env: { ...context.env }, cwd: context.cwd, origin: context.stdinIsDefault });
const deferred = () => { let resolvePromise; const promise = new Promise(accept => { resolvePromise = accept; }); return { promise, resolve: resolvePromise }; };
async function host(register) {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir('/review');
  const calls = [];
  let disposed = false;
  const shell = new Shell({ fs: filesystem, cwd: '/review', env: { PUBLIC: 'parent-public' } }).use(agentCommands()).use({
    name: 'independent-validity-' + group,
    setup(owner) { owner.use(async (context, next) => { calls.push(snapshots(context)); return next(); }); register(owner, filesystem); },
    dispose() { disposed = true; },
  });
  return { shell, filesystem, calls, async close() { await shell.dispose(); assert.equal(disposed, true); } };
}
let failure;
try {
  if (group === 'C1') {
    for (const status of [0, 7]) {
      const boundaries = [];
      const parentContexts = [];
      const instance = await host(owner => {
        owner.commands.register({ name: 'entry', async execute(context) {
          const before = snapshots(context);
          try { return await context.invoke('env', ['-S', '-i KEEP=child leaf "a b" "\\$(literal)"']); }
          finally { parentContexts.push({ before, after: snapshots(context) }); }
        } });
        owner.commands.register({ name: 'leaf', async execute(context) {
          assert.deepEqual(context.args, ['a b', '$(literal)']);
          assert.deepEqual(context.env, { KEEP: 'child' });
          await context.fs.writeFile('/review/effect', new Uint8Array([status]), { signal: context.signal });
          await context.stdout.write(Buffer.from('child:' + status));
          return { exitCode: status };
        } });
        owner.commands.register({ name: 'parentcheck', execute(context) {
          boundaries.push(snapshots(context));
          assert.deepEqual(context.args, ['parent-local', 'parent-public', String(status)]);
          assert.deepEqual(context.env, { PUBLIC: 'parent-public', PWD: '/review' });
          return { exitCode: Number(context.args[2]) };
        } });
        owner.commands.register({ name: 'resetprobe', execute(context) {
          assert.deepEqual(context.args, ['', 'parent-public']);
          assert.deepEqual(context.env, { PUBLIC: 'parent-public', PWD: '/review' });
          boundaries.push(snapshots(context)); return { exitCode: 0 };
        } });
      });
      try {
        const result = await instance.shell.exec('SECRET=parent-local; export PUBLIC=parent-public; entry; parentcheck "$SECRET" "$PUBLIC" "$?"');
        assert.equal(result.exitCode, status); assert.equal(result.stdout, 'child:' + status); assert.equal(result.stderr, '');
        assert.deepEqual(Buffer.from(await instance.filesystem.readFile('/review/effect')), Buffer.from([status]));
        assert.deepEqual(instance.calls.map(call => call.command), ['entry', 'env', 'leaf', 'parentcheck']);
        assert.equal(parentContexts.length, 1); assert.deepEqual(parentContexts[0].after, parentContexts[0].before);
        assert.equal((await instance.shell.exec('SECRET=cross-exec')).exitCode, 0);
        assert.equal((await instance.shell.exec('resetprobe "$SECRET" "$PUBLIC"')).exitCode, 0);
        assert.throws(() => assert.deepEqual({ ...boundaries[0].env, SECRET: 'leak' }, boundaries[0].env));
        assert.throws(() => assert.deepEqual(['changed', ...boundaries[0].args.slice(1)], boundaries[0].args));
        observations.push({ status, result, boundaries, parentContexts, calls: instance.calls, assertionSensitivityMutants: 2 });
      } finally { await instance.close(); }
    }
  } else if (group === 'C2') {
    for (const variant of ['default', 'invoke-empty', 'partial-binary']) {
      const captures = [];
      const pulls = [];
      let producerClosed = false;
      const source = (async function* () {
        try { pulls.push('prefix'); yield Buffer.from('00ff', 'hex'); pulls.push('suffix'); yield Buffer.from('c3a90a', 'hex'); }
        finally { producerClosed = true; }
      })();
      const instance = await host(owner => {
        owner.commands.register({ name: 'bridge', async execute(context) {
          if (variant === 'partial-binary') {
            const prefix = await context.stdin[Symbol.asyncIterator]().next();
            assert.equal(prefix.done, false); assert.equal(Buffer.from(prefix.value).toString('hex'), '00ff');
          }
          return context.invoke('env', ['-S', '-i KEEP=child sink'], variant === 'invoke-empty' ? { stdin: (async function* () {})(), stdinIsDefault: false } : undefined);
        } });
        owner.commands.register({ name: 'sink', async execute(context) {
          const bytes = [];
          for await (const chunk of context.stdin) { bytes.push(Buffer.from(chunk)); await context.stdout.write(chunk); }
          captures.push({ ...snapshots(context), hex: Buffer.concat(bytes).toString('hex') });
          return { exitCode: 0 };
        } });
      });
      try {
        const result = await instance.shell.exec('bridge', variant === 'partial-binary' ? { stdin: source } : {});
        const expectedHex = variant === 'partial-binary' ? 'c3a90a' : '';
        assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.equal(Buffer.from(result.stdoutBytes).toString('hex'), expectedHex);
        assert.deepEqual(captures, [{ command: 'sink', args: [], env: { KEEP: 'child' }, cwd: '/review', origin: variant === 'default', hex: expectedHex }]);
        assert.deepEqual(instance.calls.map(call => call.command), ['bridge', 'env', 'sink']);
        if (variant === 'partial-binary') { assert.deepEqual(pulls, ['prefix', 'suffix']); assert.equal(producerClosed, true); }
        assert.deepEqual(await instance.filesystem.readdir('/review'), []);
        assert.throws(() => assert.deepEqual({ ...captures[0], origin: !captures[0].origin }, captures[0]));
        assert.throws(() => assert.equal(expectedHex + 'ff', expectedHex));
        observations.push({ variant, result, captures, calls: instance.calls, pulls, producerClosed, assertionSensitivityMutants: 2 });
      } finally { await source.return(); await instance.close(); }
    }
  } else if (group === 'C3') {
    const policies = [
      { name: 'omitted', expected: { KEEP: 'child', PWD: '/review' } },
      { name: 'false', options: { replaceEnv: false, env: { EXTRA: 'added' } }, expected: { KEEP: 'child', EXTRA: 'added', PWD: '/review' } },
      { name: 'true-map', options: { replaceEnv: true, env: { ONLY: 'replacement' } }, expected: { ONLY: 'replacement' } },
      { name: 'true-empty', options: { replaceEnv: true }, expected: {} },
    ];
    for (const policy of policies) {
      const captures = [];
      const parentContexts = [];
      const instance = await host(owner => {
        owner.commands.register({ name: 'bridge', async execute(context) {
          const before = snapshots(context);
          try { return await context.invoke('env', ['-S', '-i KEEP=child forward "a b"']); }
          finally { parentContexts.push({ before, after: snapshots(context) }); }
        } });
        owner.commands.register({ name: 'forward', execute(context) {
          assert.deepEqual(context.env, { KEEP: 'child' });
          return context.invoke('sink', context.args, policy.options);
        } });
        owner.commands.register({ name: 'sink', async execute(context) {
          captures.push(snapshots(context)); await context.stdout.write(Buffer.from('ok')); return { exitCode: 0 };
        } });
      });
      try {
        const result = await instance.shell.exec('bridge');
        assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'ok'); assert.equal(result.stderr, '');
        assert.deepEqual(captures, [{ command: 'sink', args: ['a b'], env: policy.expected, cwd: '/review', origin: true }]);
        assert.deepEqual(instance.calls.map(call => call.command), ['bridge', 'env', 'forward', 'sink']);
        assert.deepEqual(parentContexts[0].after, parentContexts[0].before);
        assert.throws(() => assert.deepEqual({ ...policy.expected, SECRET: 'leaked' }, policy.expected));
        observations.push({ policy: policy.name, result, captures, parentContexts, calls: instance.calls, assertionSensitivityMutants: 1 });
      } finally { await instance.close(); }
    }
  } else if (group === 'C4') {
    for (const maxCommands of [2, 3]) {
      const reached = [];
      const instance = await host(owner => {
        owner.commands.register({ name: 'bridge', execute: context => context.invoke('env', ['-S', 'leaf']) });
        owner.commands.register({ name: 'leaf', execute(context) { reached.push(snapshots(context)); return { exitCode: 0 }; } });
      });
      try {
        let error;
        let result;
        try { result = await instance.shell.exec('bridge', { limits: { maxCommands } }); } catch (caught) { error = caught; }
        if (maxCommands === 2) { assert.ok(error instanceof ShellLimitError); assert.equal(error.limit, 'maxCommands'); assert.deepEqual(reached, []); }
        else { assert.equal(error, undefined); assert.equal(result.exitCode, 0); assert.equal(reached.length, 1); }
        assert.deepEqual(instance.calls.map(call => call.command), maxCommands === 2 ? ['bridge', 'env'] : ['bridge', 'env', 'leaf']);
        observations.push({ maxCommands, result, error: error && { name: error.name, limit: error.limit }, reached, calls: instance.calls });
      } finally { await instance.close(); }
    }
  } else if (group === 'C5') {
    const entered = deferred();
    const cleanupStarted = deferred();
    const cleanupGate = deferred();
    const events = [];
    const parentContexts = [];
    const controller = new AbortController();
    const reason = new contracts.FsError('ENOENT', { path: '/independent-cancel' });
    let lateReject;
    let released = 0;
    let admission = true;
    let completion;
    let settled = false;
    const cleanup = () => completion ??= (async () => { admission = false; events.push('cleanup-start'); cleanupStarted.resolve(); await cleanupGate.promise; released++; events.push('cleanup-end'); })();
    const instance = await host(owner => {
      owner.commands.register({ name: 'bridge', async execute(context) {
        const before = snapshots(context);
        try { return await context.invoke('env', ['-S', '-i ONLY=child waiter']); }
        finally { parentContexts.push({ before, after: snapshots(context) }); }
      } });
      owner.commands.register({ name: 'waiter', async execute(context) {
        assert.equal(typeof context.registerCleanup, 'function');
        context.registerCleanup(cleanup); events.push('registered');
        assert.equal(admission, true); assert.equal(context.signal.aborted, false);
        assert.deepEqual(context.env, { ONLY: 'child' }); events.push('acquired');
        const pending = new Promise((_accept, reject) => { lateReject = reject; });
        entered.resolve();
        try { return await pending; } finally { await cleanup(); }
      } });
    });
    let pending;
    try {
      pending = instance.shell.exec('bridge', { signal: controller.signal });
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await Promise.race([entered.promise, pending]);
      controller.abort(reason);
      await cleanupStarted.promise; await nextTurn(); await nextTurn();
      assert.equal(settled, false); assert.equal(admission, false); assert.equal(released, 0);
      cleanupGate.resolve();
      await assert.rejects(pending, error => error === reason);
      assert.equal(released, 1);
      lateReject(new Error('independent deliberate late rejection'));
      await nextTurn(); await nextTurn();
      assert.deepEqual(events, ['registered', 'acquired', 'cleanup-start', 'cleanup-end']);
      assert.equal(parentContexts.length, 1); assert.deepEqual(parentContexts[0].after, parentContexts[0].before);
      assert.deepEqual(instance.calls.map(call => call.command), ['bridge', 'env', 'waiter']);
      observations.push({ sameReason: true, reason: { name: reason.name, code: reason.code, path: reason.path }, events, released, admission, parentContexts, calls: instance.calls, lateRejectionObservedByStrictNode: true });
    } finally { cleanupGate.resolve(); if (!controller.signal.aborted) controller.abort(reason); if (pending) await pending.catch(() => {}); await instance.close(); }
  } else if (group === 'C6') {
    for (const maxOutputBytes of [7, 6]) {
      const sinkEntered = deferred();
      const sinkGate = deferred();
      const writes = [];
      const events = [];
      let settled = false;
      const instance = await host(owner => {
        owner.commands.register({ name: 'leaf', async execute(context) { await context.stdout.write(Buffer.from('abc')); events.push('leaf-write-complete'); return { exitCode: 0 }; } });
      });
      let pending;
      try {
        pending = instance.shell.exec("env -S 'leaf'; printf TAIL", {
          limits: { maxOutputBytes },
          stdout: { async write(bytes) { const owned = Buffer.from(bytes); events.push('sink-enter:' + owned.toString()); sinkEntered.resolve(); await sinkGate.promise; writes.push(owned); events.push('sink-end:' + owned.toString()); } },
        });
        void pending.then(() => { settled = true; }, () => { settled = true; });
        await Promise.race([sinkEntered.promise, pending]); await nextTurn();
        assert.equal(settled, false); assert.deepEqual(writes, []); assert.equal(events.includes('leaf-write-complete'), false);
        sinkGate.resolve();
        let result;
        let error;
        try { result = await pending; } catch (caught) { error = caught; }
        if (maxOutputBytes === 7) { assert.equal(error, undefined); assert.equal(result.stdout, 'abcTAIL'); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 0); }
        else { assert.ok(error instanceof ShellLimitError); assert.equal(error.limit, 'maxOutputBytes'); }
        assert.equal(Buffer.concat(writes).toString(), maxOutputBytes === 7 ? 'abcTAIL' : 'abc');
        assert.deepEqual(events.slice(0, 3), ['sink-enter:abc', 'sink-end:abc', 'leaf-write-complete']);
        assert.deepEqual(instance.calls.map(call => call.command), ['env', 'leaf', 'printf']);
        observations.push({ maxOutputBytes, result, error: error && { name: error.name, limit: error.limit }, outputHex: Buffer.concat(writes).toString('hex'), events, calls: instance.calls });
      } finally { sinkGate.resolve(); if (pending) await pending.catch(() => {}); await instance.close(); }
    }
  }
  assert.deepEqual(forbidden, []);
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
console.log(JSON.stringify({ group, passed: !failure, resolved, loaded, forbidden, observations, failure }));
