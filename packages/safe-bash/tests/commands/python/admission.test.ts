import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import type { CommandContext } from '../../../src/contracts/command.js';
import { createPythonCommands, type PythonWorkerEndpoint } from '../../../src/commands/python/index.js';
import { registerYieldCheckpoint } from '../../../src/contracts/yield.js';

function context(signal = new AbortController().signal): CommandContext {
  return { command: 'python', args: ['-c', 'pass'], cwd: '/', env: {}, fs: new MemoryFileSystem(), signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } };
}

test('an already failed endpoint is retired without sending interpreter startup', async () => {
  let started = 0;
  let terminated = 0;
  const failure = new Error('worker failed before subscription');
  const endpoint: PythonWorkerEndpoint = {
    subscribe(_listener, onError) { onError(failure); return () => {}; },
    postMessage() { started++; },
    terminate() { terminated++; },
  };
  const diagnostics: unknown[] = [];
  const [command] = createPythonCommands({ createWorker: () => endpoint, onDiagnostic(event) { diagnostics.push(event); } });
  assert.equal((await command!.execute(context())).exitCode, 1);
  assert.equal((diagnostics[0] as { cause: unknown }).cause, failure);
  assert.equal((diagnostics[0] as { failure: { category: string } }).failure.category, 'transport-unavailable');
  assert.equal(started, 0);
  assert.equal(terminated, 1);
});

test('empty stdin fragments yield the host event loop so deadline cancellation can retire Python', async () => {
  const controller = new AbortController();
  let pulls = 0;
  let terminated = 0;
  let send!: (value: unknown) => void;
  const endpoint: PythonWorkerEndpoint = {
    subscribe(listener) { send = listener; return () => {}; },
    postMessage() {
      setImmediate(() => controller.abort('stdin deadline'));
      send({ op: 'stdin', args: [1] });
    },
    terminate() { terminated++; },
  };
  const [command] = createPythonCommands({ createWorker: () => endpoint });
  const input = { async *[Symbol.asyncIterator]() {
    while (pulls < 4096) { pulls++; yield new Uint8Array(); }
    throw new Error('stdin exhausted without yielding');
  } };
  await assert.rejects(Promise.resolve(command!.execute({ ...context(controller.signal), stdin: input })), error => error === 'stdin deadline');
  assert.ok(pulls < 4096);
  assert.equal(terminated, 1);
});

test('stdin pulls preserve the caller checkpoint and release capacity after its failure', async () => {
  const controller = new AbortController();
  const failure = new Error('caller work budget exhausted');
  registerYieldCheckpoint(controller.signal, () => { throw failure; });
  let created = 0;
  let terminated = 0;
  const commands = createPythonCommands({ maxConcurrentWorkers: 1, createWorker() {
    const first = ++created === 1;
    let send!: (value: unknown) => void;
    return {
      subscribe(listener) { send = listener; return () => {}; },
      postMessage() { send(first ? { op: 'stdin', args: [1] } : { type: 'exit', exitCode: 0 }); },
      terminate() { terminated++; },
    };
  } });
  const stdin = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 256; index++) yield new Uint8Array();
    throw new Error('caller checkpoint was not observed');
  } };
  await assert.rejects(Promise.resolve(commands[0]!.execute({ ...context(controller.signal), stdin })), error => error === failure);
  assert.equal((await commands[1]!.execute(context())).exitCode, 0);
  assert.equal(created, 2);
  assert.equal(terminated, 2);
});
