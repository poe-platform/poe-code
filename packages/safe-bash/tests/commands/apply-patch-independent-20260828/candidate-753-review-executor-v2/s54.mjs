import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';

const wrap = body => `*** Begin Patch\n${body}*** End Patch\n`;
const update = wrap('*** Update File: a\n@@\n-old\n+new\n');
const add = value => wrap(`*** Add File: a\n+${value}\n`);
const text = bytes => Buffer.from(bytes).toString('utf8');
const byteEqual = (actual, expected) => assert.deepEqual(Buffer.from(actual), Buffer.from(expected));

export async function s54(job, graph, instrumented = false) {
  const load = name => import(pathToFileURL(path.join(graph.product, 'dist', name)).href);
  const api = await load('index.js');
  const command = await load('commands/apply-patch/index.js');
  const { Work } = await load('commands/apply-patch/shared.js');
  const { settings } = await load('commands/apply-patch/options.js');
  const { contents } = await load('commands/apply-patch/matcher.js');
  const results = [];
  let registrations = 0;
  let closed = 0;
  async function memory(value) {
    const filesystem = new api.MemoryFileSystem(); await filesystem.mkdir('/work');
    if (value !== undefined) await filesystem.writeFile('/work/a', Buffer.from(value));
    return filesystem;
  }
  function observe(filesystem, overrides = {}) {
    const calls = [];
    const proxy = new Proxy(filesystem, { get(target, key) {
      const method = Reflect.get(target, key, target);
      if (typeof method !== 'function') return method;
      return async (...args) => {
        calls.push({ key, path: args[0], mode: key === 'access' ? args[1] : undefined });
        if (Object.hasOwn(overrides, key)) return overrides[key](...args);
        return method.apply(target, args);
      };
    } });
    return { proxy, calls };
  }
  async function direct(filesystem, patch, extra = {}, limits) {
    const stdout = []; const stderr = []; const cleanups = [];
    const context = { command: 'apply_patch', args: [patch], cwd: '/work', env: {}, fs: filesystem,
      stdin: api.toByteSource(''), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
      registerCleanup(cleanup) { registrations++; cleanups.push(cleanup); }, ...extra };
    let rejected = false; let reason; let outcome;
    try { outcome = await command.createApplyPatchCommand(limits ? { limits } : {}).execute(context); }
    catch (error) { rejected = true; reason = error; }
    const cleanup = await Promise.allSettled(cleanups.map(async action => { try { await action(); } finally { closed++; } }));
    assert.ok(cleanup.every(row => row.status === 'fulfilled'));
    return { rejected, reason, outcome, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
  }
  function success(result, expectedOutput = 'Success. Updated the following files:\nM a\n') {
    assert.equal(result.rejected, false); assert.equal(result.outcome?.exitCode, 0, text(result.stderr));
    byteEqual(result.stdout, expectedOutput); byteEqual(result.stderr, '');
  }
  const noWrites = calls => assert.ok(!calls.some(call => ['writeFile', 'mkdir', 'rm', 'rename', 'writeStream', 'truncate'].includes(call.key)));
  const rejection = (result, reason) => { assert.equal(result.rejected, true); assert.equal(result.reason, reason); byteEqual(result.stdout, ''); byteEqual(result.stderr, ''); };
  async function test(id, body) {
    const timer = setTimeout(() => { console.error('S54_CASE_TIMEOUT_UNSAFE_STOP'); process.exit(91); }, 30000);
    try { const detail = await body(); results.push({ id, status: 'PASS', detail }); }
    catch (error) { results.push({ id, status: 'FAIL', error: error?.stack ?? String(error) }); }
    finally { clearTimeout(timer); }
    console.log(JSON.stringify({ kind: 's54-case', graph: graph.id, instrumented, ...results.at(-1) }));
  }
  if (!instrumented) {
    await test('U01', async () => {
      const payload = Buffer.from(add('x'.repeat(8197)));
      const original = Buffer.from(payload); const storage = Buffer.alloc(521, 0x65); let cursor = 0; let returned = 0; let finalized = false;
      const stdin = { [Symbol.asyncIterator]() { return {
        async next() { storage.fill(0); if (cursor === payload.length) { finalized = true; return { done: true }; }
          const length = Math.min(503, payload.length - cursor); storage.set(payload.subarray(cursor, cursor + length), 9); cursor += length;
          return { done: false, value: storage.subarray(9, 9 + length) }; },
        async return() { returned++; storage.fill(0); finalized = true; return { done: true }; },
      }; } };
      const filesystem = await memory(); const result = await direct(filesystem, undefined, { args: [], stdin });
      success(result, 'Success. Updated the following files:\nA a\n'); byteEqual(await filesystem.readFile('/work/a'), 'x'.repeat(8197) + '\n');
      byteEqual(payload, original); assert.ok(finalized); assert.ok(returned <= 1); return { inputBytes: payload.length, returned, finalized, offset: 9 };
    });
    await test('U02', async () => {
      for (const boundary of [2048, 4096]) {
        const prefix = 'é' + 'x'.repeat(boundary - Buffer.byteLength('*** Begin Patch\n*** Add File: a\n+') - 2 - 1);
        const value = prefix + '🦉tail'; const payload = Buffer.from(add(value)); assert.equal(payload[boundary - 1], 0xf0);
        const stdin = { async *[Symbol.asyncIterator]() { yield payload.subarray(0, boundary); yield Buffer.alloc(0); yield payload.subarray(boundary, boundary + 1); yield payload.subarray(boundary + 1); } };
        const filesystem = await memory(); const result = await direct(filesystem, undefined, { args: [], stdin });
        success(result, 'Success. Updated the following files:\nA a\n'); byteEqual(await filesystem.readFile('/work/a'), value + '\n');
      }
      return { byteBoundaries: [2048, 4096], emptyChunk: true };
    });
    await test('U03', async () => {
      for (const boundary of [1024, 4096]) {
        const value = 'é' + 'x'.repeat(boundary - 2) + '🦉' + '猫'.repeat(1027);
        assert.equal(value.charCodeAt(boundary - 1), 0xd83e);
        const filesystem = await memory(); success(await direct(filesystem, add(value)), 'Success. Updated the following files:\nA a\n');
        byteEqual(await filesystem.readFile('/work/a'), value + '\n');
      }
      return { utf16Boundaries: [1024, 4096] };
    });
    await test('U04', async () => {
      for (const ending of ['\n', '\r\n']) for (const terminated of [false, true]) {
        const initial = 'x'.repeat(2047) + ending + 'old' + (terminated ? ending : '');
        const filesystem = await memory(initial); success(await direct(filesystem, update));
        byteEqual(await filesystem.readFile('/work/a'), 'x'.repeat(2047) + ending + 'new' + (terminated ? ending : ''));
      }
      return { newlineVariants: 4 };
    });
    await test('U05', async () => {
      for (const reason of [false, 0, '', { marker: 'preabort' }]) {
        const root = new AbortController(); root.abort(reason); const filesystem = await memory('old\n'); const watched = observe(filesystem);
        let acquired = 0; const stdin = { [Symbol.asyncIterator]() { acquired++; throw new Error('unexpected acquisition'); } };
        rejection(await direct(watched.proxy, update, { signal: root.signal, stdin }), reason);
        assert.equal(watched.calls.length, 0); assert.equal(acquired, 0); byteEqual(await filesystem.readFile('/work/a'), 'old\n');
      }
      return { exactReasons: 4, noAcquisition: true };
    });
    await test('U06', async () => {
      for (const reason of [false, 0, '', { marker: 'read-cancel' }]) {
        const initial = 'x'.repeat(8197) + '\nold\n'; const filesystem = await memory(initial); const root = new AbortController(); let timer;
        const watched = observe(filesystem, { async readFile(...args) { const bytes = await filesystem.readFile(...args); timer = setImmediate(() => root.abort(reason)); return bytes; } });
        try { rejection(await direct(watched.proxy, update, { signal: root.signal }), reason); }
        finally { clearImmediate(timer); }
        assert.equal(root.signal.aborted, true); noWrites(watched.calls); byteEqual(await filesystem.readFile('/work/a'), initial);
      }
      return { scheduledCopyCancellation: 4 };
    });
    await test('U07', async () => {
      const reason = { marker: 'stdin-copy-cancel' }; const root = new AbortController(); const filesystem = await memory(); const watched = observe(filesystem);
      let pulls = 0; let returns = 0; let timer; const storage = Buffer.from(add('x'.repeat(8197)));
      const stdin = { [Symbol.asyncIterator]() { return { async next() { pulls++; timer = setImmediate(() => root.abort(reason)); return { done: false, value: storage }; }, async return() { returns++; storage.fill(0); return { done: true }; } }; } };
      try { rejection(await direct(watched.proxy, undefined, { args: [], stdin, signal: root.signal }), reason); }
      finally { clearImmediate(timer); }
      assert.equal(pulls, 1); assert.equal(returns, 1); assert.equal(watched.calls.length, 0); assert.ok(storage.every(byte => byte === 0));
      return { pulls, returns, finalizerZeroized: true };
    });
    await test('U08', async () => {
      const source = new Uint8Array(4097).fill(0x6b);
      for (const cap of [4096, 4097, 4098]) {
        const work = new Work({ cwd: '/work', signal: new AbortController().signal }, settings({ limits: { maxWork: cap } }));
        try {
          if (cap === 4096) await assert.rejects(work.copy(source), { message: 'maxWork limit exceeded' });
          else { const result = await work.copy(source); byteEqual(result, source); assert.notEqual(result.buffer, source.buffer); }
        } finally { work.close(); }
        byteEqual(source, Buffer.alloc(4097, 0x6b));
      }
      return { qualification: 'unmodified private Work.copy, configured work policy, not default public-cap evidence', exactCharge: 4097, caps: [4096, 4097, 4098] };
    });
    await test('U09', async () => {
      const limits = settings({}); assert.equal(limits.maxPatchBytes, 4194304); assert.equal(limits.maxFileBytes, 8388608);
      for (const extra of [0, 1]) {
        const filesystem = await memory('x'.repeat(limits.maxFileBytes - 5 + extra) + '\nold\n'); const watched = observe(filesystem);
        const result = await direct(watched.proxy, update);
        if (extra === 0) { success(result); byteEqual(await filesystem.readFile('/work/a'), 'x'.repeat(limits.maxFileBytes - 5) + '\nnew\n'); }
        else { assert.equal(result.rejected, false); assert.equal(result.outcome.exitCode, 1); byteEqual(result.stderr, 'apply_patch: target size limit exceeded or invalid size\n'); noWrites(watched.calls); }
      }
      return { fileDefaultBoundary: [8388608, 8388609], patchDefaultTriplet: 'separate unchanged L01 jobs' };
    });
    await test('U10', async () => {
      for (const nul of [false, true]) {
        const bytes = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(4100, 0x78), nul ? Buffer.from([0]) : Buffer.alloc(0)]);
        const filesystem = await memory(); const watched = observe(filesystem);
        const result = await direct(watched.proxy, undefined, { args: [], stdin: api.toByteSource(bytes) });
        assert.equal(result.rejected, false); assert.equal(result.outcome.exitCode, 2);
        byteEqual(result.stderr, nul ? 'apply_patch: NUL bytes are unsupported\n' : 'apply_patch: invalid UTF-8\n'); assert.equal(watched.calls.length, 0);
      }
      return { ordering: 'whole NUL scan before fatal UTF8 decode' };
    });
    await test('U11', async () => {
      const filesystem = await memory('old\n'); const watched = observe(new api.ReadOnlyFileSystem(filesystem));
      const result = await direct(watched.proxy, update); assert.equal(result.rejected, false); assert.equal(result.outcome.exitCode, 1);
      byteEqual(result.stderr, 'apply_patch: read-only file system\n'); noWrites(watched.calls); byteEqual(await filesystem.readFile('/work/a'), 'old\n');
      return { readonlyPrepublication: true };
    });
    await test('U12', async () => {
      for (const callerAbort of [false, true]) {
        const filesystem = await memory('old\n'); const root = new AbortController(); const primary = { marker: 'sink-primary' }; const caller = { marker: 'caller-primary' };
        const shell = new api.Shell({ fs: filesystem, cwd: '/work' }); shell.use(command.applyPatchCommands()); let cleanupEnded = false; let returned = false;
        shell.use(async (context, next) => { context.registerCleanup(async () => { await turn(); assert.equal(returned, false); cleanupEnded = true; }); return next(); });
        shell.register({ name: 'run_patch', execute: context => context.invoke('apply_patch', [update]) });
        let rejected = false; let reason;
        try { await shell.exec('run_patch', { signal: root.signal, stdout: { async write() { if (callerAbort) root.abort(caller); throw primary; } } }); }
        catch (error) { rejected = true; reason = error; }
        finally { returned = true; await shell.dispose(); }
        assert.equal(rejected, true); assert.equal(reason, callerAbort ? caller : primary); assert.equal(cleanupEnded, true); byteEqual(await filesystem.readFile('/work/a'), 'new\n');
      }
      return { publicationNotRolledBack: true, awaitedRegisteredCleanup: true, callerPrecedence: true };
    });
  } else {
    const bare = () => new Work({ cwd: '/work', signal: new AbortController().signal }, settings({}));
    const hooks = globalThis.s54Hooks;
    assert.ok(hooks && typeof hooks === 'object');
    await test('I01', async () => {
      hooks.events.length = 0; const work = bare(); const source = new Uint8Array(8197).fill(7);
      try { work.step(17); byteEqual(await work.copy(source), source); }
      finally { work.close(); }
      const copies = hooks.events.filter(event => event.kind === 'copy');
      assert.deepEqual(copies.map(event => event.count), [4079, 4096, 22]);
      assert.ok(copies.every(event => event.count <= 4096)); return { copies };
    });
    await test('I02', async () => {
      hooks.events.length = 0; const work = bare();
      try { work.step(4103); await work.checkpoint(); assert.equal(work.nextYield, 8192); }
      finally { work.close(); }
      return { qualification: 'private threshold observation; not elapsed hard deadline' };
    });
    await test('I03', async () => {
      hooks.events.length = 0; const work = bare(); const value = 'x'.repeat(1023) + '🦉' + '猫'.repeat(2050); const target = new Uint8Array(Buffer.byteLength(value));
      try { assert.equal(await work.encodeInto(value, target, 0), target.length); }
      finally { work.close(); }
      byteEqual(target, Buffer.from(value)); const encodes = hooks.events.filter(event => event.kind === 'encode');
      assert.ok(encodes.length >= 4 && encodes.every(event => event.units <= 1024 && !event.danglingHigh));
      return { encodes };
    });
    await test('I04', async () => {
      hooks.events.length = 0; const work = new Work({ cwd: '/work', signal: new AbortController().signal }, settings({ limits: { maxWork: 4100 } }));
      const file = { kind: 'add', label: 'a', added: ['x'.repeat(4097)] };
      try { await assert.rejects(contents(file, undefined, work), { message: 'maxWork limit exceeded' }); }
      finally { work.close(); }
      assert.equal(hooks.events.some(event => event.kind === 'stage-allocation'), false);
      assert.equal(hooks.events.some(event => event.kind === 'stage-admit'), true);
      return { preAllocationAdmission: true, heapClaim: false };
    });
  }
  assert.equal(registrations, closed);
  return { results, registrations, closed };
}
