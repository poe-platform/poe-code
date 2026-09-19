import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { createCsvkitCommands } from '../../src/commands/csvkit/index.js';
import { utf8Codec } from '@poe-code/csvkit';
import reference from '../../../../docs/csvkit/in2csv-reference.json' with { type: 'json' };

test('closing stdout during a side-file write drains sibling files through invocation cleanup', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/book.xlsx', Buffer.from(reference.binary['book.xlsx'], 'base64'));
  const consumer = new AbortController(); const caller = new AbortController(); const reason = new Error('stdout consumer closed');
  const open = fs.open!.bind(fs); let triggered = false;
  Object.assign(fs, { async open(path: string, settings: Parameters<typeof open>[1]) {
    const descriptor = await open(path, settings);
    return new Proxy(descriptor, { get(target, key) {
      if (key === 'write' && path === '/book_0.csv') return async (...args: Parameters<typeof descriptor.write>) => {
        if (!triggered) { triggered = true; consumer.abort(reason); }
        await Promise.resolve(); return await descriptor.write(...args);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  const command = createCsvkitCommands({ codecs: [utf8Codec], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }).find(item => item.name === 'in2csv')!;
  const cleanups: (() => void | Promise<void>)[] = []; const writes: string[] = [];
  const write = async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); };
  await assert.rejects(Promise.resolve(command.execute({ command: 'in2csv', args: ['--write-sheets','-','/book.xlsx'], cwd: '/', env: {}, fs,
    signal: caller.signal, stdin: { async *[Symbol.asyncIterator]() { assert.fail('named workbook does not consume stdin'); yield new Uint8Array(); } },
    stdout: { write, ownedOutput: { write, consumerClosed: consumer.signal } }, stderr: { write: async () => { assert.fail('stdout closure cannot produce diagnostics'); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  })), caught => caught === reason);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.deepEqual(writes, ['n,text\n','3,second\n']);
  assert.equal(new TextDecoder().decode(await fs.readFile('/book_0.csv')), 'n,text\n2.5,é\n');
  assert.equal(new TextDecoder().decode(await fs.readFile('/book_1.csv')), 'n,text\n3,second\n');
  assert.equal(caller.signal.aborted, false);
});
