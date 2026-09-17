import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import * as python from '../../../src/commands/python/index.js';
import type { CommandContext, InvocationCleanup } from '../../../src/contracts/command.js';

const secret = 'https://user:password@example.test/runtime?token=secret';

function endpoint(message: unknown = { type: 'exit', exitCode: 0 }): python.PythonWorkerEndpoint {
  let send!: (message: unknown) => void;
  return {
    subscribe(listener) { send = listener; return () => {}; },
    postMessage() { queueMicrotask(() => send(message)); },
    async terminate() {},
  };
}

test('Python factory failure has a safe diagnostic and permits the next command', async () => {
  const failure = new Error(secret);
  const diagnostics: unknown[] = [];
  let attempts = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
    maxConcurrentWorkers: 1,
    createWorker() { if (++attempts === 1) throw failure; return endpoint(); },
    onDiagnostic(event: unknown) { diagnostics.push(event); },
  }));
  try {
    const result = await shell.exec('python -c pass');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Python startup failed/);
    assert.doesNotMatch(result.stderr, /internal error|password|token=secret/);
    assert.equal((diagnostics[0] as { failure: { category: string } }).failure.category, 'startup');
    assert.equal((diagnostics[0] as { cause: unknown }).cause, failure);
    assert.equal((await shell.exec('python3 -c pass')).exitCode, 0);
  } finally { await shell.dispose(); await shell.dispose(); }
});

for (const category of ['runtime-abi', 'runtime-assets', 'transport-unavailable']) {
  test(`Python worker ${category} failures never disclose raw loader messages`, async () => {
    const diagnostics: unknown[] = [];
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
      createWorker: () => endpoint({ type: 'error', category, message: secret }),
      onDiagnostic(event: unknown) { diagnostics.push(event); },
    }));
    try {
      const result = await shell.exec('python -c pass');
      assert.equal(result.exitCode, 1);
      assert.doesNotMatch(result.stderr, /password|token=secret|example.test/);
      assert.equal((diagnostics[0] as { failure: { category: string } }).failure.category, category);
      assert.equal((diagnostics[0] as { cause: unknown }).cause, secret);
    } finally { await shell.dispose(); }
  });
}

test('unknown worker error categories produce only a fixed safe startup failure', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
    createWorker: () => endpoint({ type: 'error', category: secret, message: secret }),
  }));
  try {
    const result = await shell.exec('python -c pass');
    assert.match(result.stderr, /Python startup failed/);
    assert.doesNotMatch(result.stderr, /password|token=secret|example.test/);
  } finally { await shell.dispose(); }
});

test('portable Python preflight identifies absent executors without loading one', () => {
  const report = python.inspectPythonCapabilities({});
  assert.equal(report.configurationValid, false);
  assert.equal(report.failures[0]?.category, 'executor-unavailable');
});

test('Python preflight reports missing handles only when file access is required', () => {
  const fs = new MemoryFileSystem();
  Object.defineProperty(fs, 'open', { value: undefined });
  const createWorker = () => endpoint();
  assert.equal(python.inspectPythonCapabilities({ createWorker, fs }).configurationValid, true);
  const report = python.inspectPythonCapabilities({ createWorker, fs, requiredFileSystem: ['open'] });
  assert.equal(report.configurationValid, false);
  assert.equal(report.failures[0]?.category, 'filesystem-open');
});

test('diagnostic observers cannot leak their own failures into guest output', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
    createWorker() { throw new Error('failed'); },
    onDiagnostic() { throw new Error(secret); },
  }));
  try {
    const result = await shell.exec('python -c pass');
    assert.match(result.stderr, /Python startup failed/);
    assert.doesNotMatch(result.stderr, /password|token=secret/);
  } finally { await shell.dispose(); }
});

test('cleanup failures are typed, observed once, and retain unconfirmed worker capacity', async () => {
  const failure = new Error(secret);
  const diagnostics: python.PythonDiagnostic[] = [];
  let created = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
    maxConcurrentWorkers: 1,
    createWorker() { created++; return { ...endpoint(), terminate() { throw failure; } }; },
    onDiagnostic(event) { diagnostics.push(event); },
  }));
  await assert.rejects(shell.exec('python -c pass'), error => {
    assert.ok(error instanceof python.PythonFailure);
    assert.equal(error.category, 'cleanup');
    assert.doesNotMatch(error.message, /password|token=secret/);
    return true;
  });
  const busy = await shell.exec('python -c pass');
  assert.match(busy.stderr, /capacity exhausted/);
  assert.equal(created, 1);
  assert.equal(diagnostics.filter(event => event.failure.category === 'cleanup').length, 1);
  assert.equal(diagnostics[0]?.cause, failure);
  await shell.dispose();
  await shell.dispose();
});

test('cleanup is observed even when a prior runtime failure wins the direct command result', async () => {
  const diagnostics: python.PythonDiagnostic[] = [];
  const failure = new Error(secret);
  const commands = python.createPythonCommands({
    createWorker: () => ({ ...endpoint({ type: 'error', category: 'runtime', message: 'failed' }), terminate() { throw failure; } }),
    onDiagnostic(event) { diagnostics.push(event); },
  });
  const output: string[] = [];
  const context: CommandContext = { command: 'python', args: ['-c', 'pass'], cwd: '/', env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} }, stderr: { async write(bytes) { output.push(new TextDecoder().decode(bytes)); } } };
  assert.equal((await commands[0]!.execute(context)).exitCode, 1);
  assert.match(output.join(''), /Python runtime failed/);
  assert.deepEqual(diagnostics.map(event => event.failure.category), ['runtime', 'cleanup']);
  assert.equal(diagnostics[1]?.cause, failure);
});

test('missing retained open is diagnosed on use without blocking inline commands', async () => {
  const fs = new MemoryFileSystem();
  Object.defineProperty(fs, 'open', { value: undefined });
  const diagnostics: python.PythonDiagnostic[] = [];
  const shell = new Shell({ fs }).use(python.pythonCommands({
    createWorker() {
      let send!: (message: unknown) => void;
      return {
        subscribe(listener) { send = listener; return () => {}; },
        postMessage(start) {
          const message = start as python.PythonWorkerStart;
          if (message.invocation.args.includes('pass')) { send({ type: 'exit', exitCode: 0 }); return; }
          send({ op: 'open', args: ['/input', { access: 'read', creation: 'never' }] });
          const control = new Int32Array(message.shared, 0, 2);
          const observe = () => {
            if (Atomics.load(control, 0) === 0) { setImmediate(observe); return; }
            assert.equal(Atomics.load(control, 0), 2);
            send({ type: 'exit', exitCode: 1 });
          };
          setImmediate(observe);
        },
        terminate() {},
      };
    },
    onDiagnostic(event) { diagnostics.push(event); },
  }));
  try {
    assert.equal((await shell.exec('python -c pass')).exitCode, 0);
    const result = await shell.exec('python /input');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /backend must support retained open/);
    assert.equal(diagnostics[0]?.failure.category, 'filesystem-open');
  } finally { await shell.dispose(); }
});

test('preflight distinguishes explicit read/write restrictions and unsupported retained directories', () => {
  const fs = new MemoryFileSystem();
  Object.defineProperty(fs, 'capabilities', { value: { ...fs.capabilities, read: false, write: false } });
  const result = python.inspectPythonCapabilities({ createWorker: () => endpoint(), fs, requiredFileSystem: ['read', 'write', 'directory'], runtimeVersion: 'other' });
  assert.equal(result.configurationValid, false);
  assert.deepEqual(result.failures.map(failure => failure.category), ['runtime-abi', 'filesystem-read', 'filesystem-write', 'filesystem-directory']);
});

for (const message of [null, { type: 'exit', exitCode: secret }, { type: 'request', op: secret, args: null }]) {
  test('malformed worker frames are safe transport failures', async () => {
    const diagnostics: python.PythonDiagnostic[] = [];
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(python.pythonCommands({
      createWorker: () => endpoint(message), onDiagnostic(event) { diagnostics.push(event); },
    }));
    try {
      const result = await shell.exec('python -c pass');
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /Python worker transport/);
      assert.doesNotMatch(result.stderr, /internal error|password|token=secret/);
      assert.equal(diagnostics[0]?.failure.category, 'transport-unavailable');
    } finally { await shell.dispose(); }
  });
}

test('a filesystem diagnostic sink failure preserves caller identity and releases capacity', async () => {
  const failure = new Error('host output budget');
  const fs = new MemoryFileSystem();
  Object.defineProperty(fs, 'open', { value: undefined });
  let attempts = 0;
  const commands = python.createPythonCommands({ maxConcurrentWorkers: 1,
    createWorker: () => endpoint(++attempts === 1 ? { op: 'open', args: ['/input', { access: 'read', creation: 'never' }] } : { type: 'exit', exitCode: 0 }),
  });
  const cleanups: InvocationCleanup[] = [];
  const context: CommandContext = { command: 'python', args: ['-c', 'pass'], cwd: '/', env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    stdout: { async write() {} }, stderr: { async write() { throw failure; } } };
  await assert.rejects(Promise.resolve(commands[0]!.execute(context)), error => error === failure);
  for (const cleanup of cleanups) await cleanup();
  assert.equal((await commands[0]!.execute(context)).exitCode, 0);
});
