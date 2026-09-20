import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import { pythonCommands, inspectPythonCapabilities, type PythonExecutorStart } from '../../../src/commands/python/index.js';

test('async executor performs canonical binary I/O without shared memory and preserves literal invocation', async context => {
  context.mock.method(globalThis, 'SharedArrayBuffer', function () { throw new Error('shared memory forbidden'); });
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', new Uint8Array([0, 255, 42]));
  let retired = 0;
  const starts: PythonExecutorStart[] = [];
  const phases: string[] = [];
  const shell = new Shell({ fs }).use(pythonCommands({
    createExecutor() { return {
      async run(start) {
        starts.push(start);
        start.onReady();
        const handle = await start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] });
        const bytes = await start.dispatch({ op: 'read', args: [handle, 3, 0] });
        await start.dispatch({ op: 'stdout', args: [Array.from(bytes as Uint8Array)] });
        await start.dispatch({ op: 'close', args: [handle] });
        return 7;
      },
      async terminate() { retired++; },
    }; },
    onProgress(event) { phases.push(event.phase); },
  }));
  try {
    const result = await shell.exec('python3 -c pass "two words"');
    assert.equal(result.exitCode, 7);
    assert.deepEqual(result.stdoutBytes, new Uint8Array([0, 255, 42]));
    assert.deepEqual(starts[0]!.invocation.args, ['-c', 'pass', 'two words']);
    assert.equal(starts[0]!.invocation.command, 'python3');
    assert.equal(retired, 1);
    assert.deepEqual(phases, ['initializing', 'ready', 'finished']);
  } finally { await shell.dispose(); }
});

test('async capability inspection does not require the worker shared-memory transport', async context => {
  context.mock.property(globalThis, 'SharedArrayBuffer', undefined);
  const createExecutor = () => ({ async run() { return 0; }, async terminate() {} });
  const report = inspectPythonCapabilities({ createExecutor });
  assert.equal(report.configurationValid, true);
  assert.deepEqual(report.failures, []);
  assert.throws(() => pythonCommands({ createExecutor, createWorker: () => ({} as never) }), /executor|transport/i);
});

test('Shell cancellation lets the asynchronous executor release descriptors before retiring its filesystem service', async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile('/input', new Uint8Array([42]));
  let entered!: () => void;
  let finished!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const retired = new Promise<void>(resolve => { finished = resolve; });
  let released = false;
  const shell = new Shell({fs:filesystem}).use(pythonCommands({createExecutor: () => ({
    async run(start) {
      try {
        const handle = await start.dispatch({op:'open',args:['/input',{access:'read'}]});
        entered();
        await new Promise<void>(resolve => { start.signal.addEventListener('abort', () => resolve(), {once:true}); });
        await start.dispatch({op:'close',args:[handle]});
        released = true;
        return 130;
      } finally { finished(); }
    },
    terminate() { return retired; },
  })}));
  const execution = shell.exec('python -c pass').catch(() => undefined);
  await started;
  await shell.dispose();
  await execution;
  assert.equal(released, true);
});

test('async executor failures expose safe diagnostics and retire only their invocation', async () => {
  let retired = 0;
  let attempts = 0;
  const causes: unknown[] = [];
  const secret = new Error('https://user:password@example.test/?token=secret');
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ maxConcurrentWorkers: 1,
    createExecutor: () => ({
      async run(start) { start.onReady(); if (attempts++ === 0) throw secret; return 0; },
      async terminate() { retired++; },
    }),
    onDiagnostic(event) { causes.push(event.cause); },
  }));
  try {
    const failed = await shell.exec('python -c pass');
    assert.equal(failed.exitCode, 1);
    assert.ok(!failed.stderr.includes('password'));
    assert.ok(causes.includes(secret));
    assert.equal((await shell.exec('python -c pass')).exitCode, 0);
    assert.equal(retired, 2);
  } finally { await shell.dispose(); }
});

test('async executor cannot swallow a host readiness observer failure and report success', async () => {
  let retired = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createExecutor: () => ({
      async run(start) { try { start.onReady(); } catch {} return 0; },
      async terminate() { retired++; },
    }),
    onProgress(event) { if (event.phase === 'ready') throw new Error('progress failed'); },
  }));
  try {
    assert.notEqual((await shell.exec('python -c pass')).exitCode, 0);
    assert.equal(retired, 1);
  } finally { await shell.dispose(); }
});

test('async package transport failures keep the safe package diagnostic without leaking host errors', async () => {
  const failure = new Error('private package TLS credentials');
  const diagnostics: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createExecutor: () => ({
      async run(start) {
        start.onReady();
        assert.ok(start.packages);
        await assert.rejects(start.dispatch({ op: 'package-open', args: [start.packages.session, 'https://example.test/pkg.whl'] }),
          error => error instanceof Error && 'code' in error && error.code === 'EPACKAGE' && !error.message.includes('credentials'));
        return 1;
      },
      async terminate() {},
    }),
    provisioning: { authorize: () => true, transport: async () => { throw failure; } },
    onDiagnostic(event) { diagnostics.push(event.failure.category); },
  }));
  try {
    assert.equal((await shell.exec('python -c pass')).exitCode, 1);
    assert.deepEqual(diagnostics, ['runtime-assets']);
  } finally { await shell.dispose(); }
});
