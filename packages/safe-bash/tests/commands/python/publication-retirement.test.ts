import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import type { CommandContext } from '../../../src/contracts/command.js';
import { createPythonCommands } from '../../../src/commands/python/index.js';
function invocation(signal = new AbortController().signal) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const fs = new MemoryFileSystem();
  const context: CommandContext = {
    command: 'python', args: ['-c', 'pass'], cwd: '/', env: {}, fs, signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  return { context, fs, stdout, stderr, cleanups };
}

test('drained close-time publication failure releases command capacity after confirmed interpreter termination (#4136)', async () => {
  const host = invocation();
  const closeFailure = new Error('cancelled publication');
  const open = host.fs.open.bind(host.fs);
  host.fs.open = async (...args) => {
    const descriptor = await open(...args);
    return { ...descriptor, capabilities: descriptor.capabilities,
      stat: descriptor.stat.bind(descriptor), read: descriptor.read.bind(descriptor),
      write: descriptor.write.bind(descriptor), truncate: descriptor.truncate.bind(descriptor),
      sync: descriptor.sync.bind(descriptor), async close(options) {
        await descriptor.close(options);
        throw closeFailure;
      } };
  };
  let runs = 0;
  const [command] = createPythonCommands({ maxConcurrentWorkers: 1, createExecutor: () => ({
    async run(start) {
      if (++runs === 1) await start.dispatch({ op: 'open', args: ['/large', { access: 'write', creation: 'ifMissing' }] });
      return 0;
    },
    async terminate() {},
  }) });
  assert.equal((await command!.execute(host.context)).exitCode, 1);
  assert.equal((await command!.execute(invocation().context)).exitCode, 0);
  assert.equal(runs, 2);
});
