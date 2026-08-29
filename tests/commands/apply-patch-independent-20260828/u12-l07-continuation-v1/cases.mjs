import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';

const job = globalThis.continuationJob;
const api = await import(job.layout === 'source' ? pathToFileURL(path.join(job.product, 'dist/index.js')).href : 'virtual-bash');
const command = await import(pathToFileURL(path.join(job.product, 'dist/commands/apply-patch/index.js')).href);
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = value => ({ bytes: value.length, sha256: hash(value), hex: Buffer.from(value).toString('hex') });
const address = value => ({ bytes: Buffer.byteLength(value), sha256: hash(value) });
const results = [];
const unhandled = [];
process.on('unhandledRejection', reason => unhandled.push(reason));
const summary = 'Success. Updated the following files:\nM a\n';
const patch = '*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch\n';

async function memory() {
  const filesystem = new api.MemoryFileSystem();
  await filesystem.mkdir('/work');
  await filesystem.writeFile('/sentinel', Buffer.from('00ff8053656e74696e656c0d0a', 'hex'));
  return filesystem;
}

async function sinkCase(callerAbort) {
  const filesystem = await memory();
  await filesystem.writeFile('/work/a', Buffer.from('old\n'));
  const shell = new api.Shell({ fs: filesystem, cwd: '/work' });
  shell.use(command.applyPatchCommands());
  const controller = new AbortController();
  const primary = { marker: 'sink-primary' };
  const caller = { marker: 'caller-primary' };
  const sink = [];
  const errors = [];
  const cleanup = [];
  let settled = false;
  shell.use(async (context, next) => {
    const row = { command: context.command, starts: 0, ends: 0, sawSettled: false };
    cleanup.push(row);
    context.registerCleanup(async () => {
      row.starts++;
      await turn();
      row.sawSettled = settled;
      row.ends++;
    });
    return next();
  });
  shell.register({ name: 'run_patch', execute: context => context.invoke('apply_patch', [patch]) });
  let result;
  let reason;
  let rejected = false;
  try {
    result = await shell.exec('run_patch', {
      signal: controller.signal,
      stdout: { async write(chunk) {
        const row = { chunk: bytes(chunk), thrownIsPrimary: false, callerAbortedBeforeThrow: false };
        sink.push(row);
        if (callerAbort) controller.abort(caller);
        row.callerAbortedBeforeThrow = controller.signal.aborted;
        try { throw primary; } catch (error) { row.thrownIsPrimary = error === primary; throw error; }
      } },
      stderr: { async write(chunk) { errors.push(Buffer.from(chunk)); } },
    });
  } catch (error) { rejected = true; reason = error; }
  settled = true;
  const atSettlement = {
    rejected,
    reasonIsPrimary: rejected && reason === primary,
    reasonIsCaller: rejected && reason === caller,
    reasonIsUndefined: rejected && reason === undefined,
    reasonType: rejected ? typeof reason : null,
    result: result === undefined ? null : {
      exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
      stdoutBytes: bytes(result.stdoutBytes), stderrBytes: bytes(result.stderrBytes),
    },
    callerAborted: controller.signal.aborted,
    callerReasonIsCaller: controller.signal.aborted && controller.signal.reason === caller,
    sink: structuredClone(sink), stderr: bytes(Buffer.concat(errors)), cleanup: structuredClone(cleanup),
  };
  let snapshotFailure;
  try {
    atSettlement.file = bytes(await filesystem.readFile('/work/a'));
    atSettlement.sentinel = bytes(await filesystem.readFile('/sentinel'));
  } catch (error) { snapshotFailure = String(error); }
  let disposeFailure;
  try { await shell.dispose(); } catch (error) { disposeFailure = String(error); }
  const observation = { atSettlement, snapshotFailure: snapshotFailure ?? null, disposeFailure: disposeFailure ?? null, cleanupAfterDispose: structuredClone(cleanup) };
  const failures = [];
  const check = (name, action) => { try { action(); } catch (error) { failures.push({ name, error: error.message }); } };
  check('snapshot and separate disposal', () => { assert.equal(snapshotFailure, undefined); assert.equal(disposeFailure, undefined); });
  check('sink bytes and thrown identity', () => {
    assert.equal(sink.length, 1); assert.equal(sink[0].chunk.hex, Buffer.from(summary).toString('hex'));
    assert.equal(sink[0].thrownIsPrimary, true); assert.equal(sink[0].callerAbortedBeforeThrow, callerAbort);
  });
  check('cleanup completed at settlement once, not merely disposal', () => {
    assert.deepEqual(atSettlement.cleanup.map(row => row.command).sort(), ['apply_patch', 'run_patch']);
    assert.ok(atSettlement.cleanup.every(row => row.starts === 1 && row.ends === 1 && row.sawSettled === false));
    assert.deepEqual(cleanup, atSettlement.cleanup);
  });
  check('publication not rolled back', () => {
    assert.equal(atSettlement.file.hex, Buffer.from('new\n').toString('hex'));
    assert.equal(atSettlement.sentinel.hex, '00ff8053656e74696e656c0d0a');
  });
  check('public result and caller precedence', () => {
    assert.equal(rejected, callerAbort);
    assert.equal(atSettlement.callerAborted, callerAbort);
    if (callerAbort) {
      assert.equal(reason, caller); assert.equal(atSettlement.callerReasonIsCaller, true);
      assert.equal(result, undefined); assert.equal(atSettlement.stderr.hex, '');
    } else {
      assert.equal(result.exitCode, 1); assert.equal(result.stdout, summary);
      assert.equal(result.stderr, 'shell: line 1: [object Object]\n');
      assert.equal(atSettlement.result.stdoutBytes.hex, Buffer.from(summary).toString('hex'));
      assert.equal(atSettlement.result.stderrBytes.hex, atSettlement.stderr.hex);
    }
  });
  return { observation, failures };
}

function target(size) {
  return '/' + [...Array(64).fill('x'.repeat(252)), 'y'.repeat(size - 16193)].join('/');
}

async function limitCase(size) {
  const filename = target(size);
  const patchText = `*** Begin Patch\n*** Add File: ${filename}\n+\n*** End Patch\n`;
  const filesystem = await memory();
  const controller = new AbortController();
  const calls = [];
  const observed = new Proxy(filesystem, { get(object, key) {
    const value = Reflect.get(object, key, object);
    if (typeof value !== 'function') return value;
    return async (...args) => {
      calls.push({ method: String(key), path: typeof args[0] === 'string' ? address(args[0]) : null });
      if (calls.length > 65536) throw new Error('OBSERVER_FS_CAP_UNSAFE_STOP');
      return value.apply(object, args);
    };
  } });
  let acquired = 0;
  let pulls = 0;
  let returned = 0;
  const cleanups = [];
  const output = [];
  const errors = [];
  let result;
  let reason;
  let rejected = false;
  try {
    result = await command.createApplyPatchCommand().execute({
      command: 'apply_patch', args: [], cwd: '/work', env: {}, fs: observed,
      signal: controller.signal, stdinIsDefault: false,
      stdin: { [Symbol.asyncIterator]() { acquired++; return {
        async next() { pulls++; return pulls === 1 ? { done: false, value: Buffer.from(patchText) } : { done: true }; },
        async return() { returned++; return { done: true }; },
      }; } },
      stdout: { async write(chunk) { output.push(Buffer.from(chunk)); } },
      stderr: { async write(chunk) { errors.push(Buffer.from(chunk)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    });
  } catch (error) { rejected = true; reason = error; }
  const cleanupResults = await Promise.allSettled(cleanups.map(cleanup => cleanup()));
  const namespace = [];
  async function snapshot(filename) {
    const stat = await filesystem.lstat(filename);
    const row = { path: address(filename), type: stat.type };
    if (stat.type === 'file') row.content = bytes(await filesystem.readFile(filename));
    namespace.push(row);
    if (stat.type === 'directory') for (const entry of (await filesystem.readdir(filename)).map(entry => typeof entry === 'string' ? entry : entry.name).sort()) await snapshot(filename === '/' ? '/' + entry : filename + '/' + entry);
  }
  await snapshot('/');
  const observation = {
    input: { path: address(filename), componentLengths: filename.split('/').slice(1).map(part => Buffer.byteLength(part)), patch: address(patchText) },
    rejected, reasonType: rejected ? typeof reason : null, exitCode: result?.exitCode ?? null,
    stdout: bytes(Buffer.concat(output)), stderr: bytes(Buffer.concat(errors)), stdoutChunks: output.map(chunk => chunk.length),
    acquired, pulls, returned, cleanups: cleanups.length, cleanupFailures: cleanupResults.filter(row => row.status === 'rejected').length,
    calls, namespace, aborted: controller.signal.aborted,
  };
  const failures = [];
  const check = (name, action) => { try { action(); } catch (error) { failures.push({ name, error: error.message }); } };
  const over = size > 16384;
  check('exact path and provider legal components', () => {
    assert.equal(Buffer.byteLength(filename), size); assert.equal(observation.input.componentLengths.length, 65);
    assert.ok(observation.input.componentLengths.every(length => length <= 255));
  });
  check('result bytes', () => {
    assert.equal(rejected, false); assert.equal(result.exitCode, over ? 1 : 0);
    assert.equal(observation.stdout.hex, Buffer.from(over ? '' : `Success. Updated the following files:\nA ${filename}\n`).toString('hex'));
    assert.equal(observation.stderr.hex, Buffer.from(over ? 'apply_patch: UTF-8 byte limit exceeded\n' : '').toString('hex'));
  });
  check('complete namespace and publication', () => {
    const expected = [
      { path: address('/'), type: 'directory' },
      { path: address('/sentinel'), type: 'file', content: bytes(Buffer.from('00ff8053656e74696e656c0d0a', 'hex')) },
      { path: address('/work'), type: 'directory' },
    ];
    if (!over) {
      const components = filename.split('/').slice(1);
      for (let count = 1; count < components.length; count++) expected.push({ path: address('/' + components.slice(0, count).join('/')), type: 'directory' });
      expected.push({ path: address(filename), type: 'file', content: bytes(Buffer.from('\n')) });
    }
    const ordered = rows => [...rows].sort((left, right) => left.path.sha256.localeCompare(right.path.sha256));
    assert.deepEqual(ordered(namespace), ordered(expected));
  });
  check('cleanup and preflight', () => {
    assert.equal(acquired, 1); assert.equal(pulls, 2); assert.equal(returned, 0);
    assert.equal(cleanups.length, 1); assert.equal(observation.cleanupFailures, 0); assert.equal(controller.signal.aborted, false);
    if (over) assert.equal(calls.length, 0);
    else { assert.ok(calls.some(row => row.method === 'writeFile')); assert.deepEqual(observation.stdoutChunks, [16384, size + 41 - 16384]); }
  });
  return { observation, failures };
}

for (const id of job.cases) {
  const timer = setTimeout(() => { console.error('CASE_TIMEOUT_UNSAFE_STOP'); process.exit(91); }, 30000);
  try {
    const result = id.startsWith('U12') ? await sinkCase(id === 'U12-v2-caller') : await limitCase(Number(id.slice(4)));
    const row = { kind: 'case', layout: job.layout, id, status: result.failures.length ? 'FAIL' : 'PASS', ...result };
    console.log(JSON.stringify(row)); results.push({ id, status: row.status, failures: row.failures });
  } finally { clearTimeout(timer); }
}
await turn(); await turn();
assert.equal(unhandled.length, 0, 'unhandled rejection UNSAFE_STOP');
console.log(JSON.stringify({ kind: 'final', layout: job.layout, results, loads: globalThis.continuationLoads, unhandled: unhandled.length, complete: true }));
