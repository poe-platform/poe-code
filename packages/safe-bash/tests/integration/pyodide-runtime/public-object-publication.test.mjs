import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const consumer = process.env.SAFE_BASH_PYTHON_CONSUMER_DIR;
if (!consumer) throw new Error('SAFE_BASH_PYTHON_CONSUMER_DIR must name an installed standalone package with pinned Pyodide');

test('installed Python reads, imports and publishes bounded outputs on flat and delayed immutable backends', { timeout: 90000 }, async context => {
  const source = `
    import assert from 'node:assert/strict';
    import { Shell, pythonCommands } from '@poe-platform/safe-bash';
    import { createNodePythonWorker } from '@poe-platform/safe-bash/commands/python/node';
    import { MemoryFileSystem, FsError, withObjectFileDescriptors } from '@poe-platform/safe-fs/core';
    import { createObjectFilePublicationConformanceCases } from '@poe-platform/safe-fs/testing/object-publication';
    const encoder = new TextEncoder();
    const python = ${JSON.stringify(`from pathlib import Path
import helper, os
assert helper.answer == 42
assert Path('/input.txt').read_text() == 'canonical input'
with open('/binary', 'rb') as source:
 source.seek(131071)
 assert source.read(4) == bytes([255, 0, 1, 2])
with open('/output', 'w+b') as output:
 for index in range(32):
  output.write(bytes([index]) * 65536)
  output.flush()
  os.fsync(output.fileno())
 output.seek(65536)
 assert output.read(3) == bytes([1, 1, 1])
 output.truncate(65538)
 output.flush()
 os.fsync(output.fileno())
with open('/output', 'ab') as output:
 output.write(b'end')
assert Path('/output').stat().st_size == 65541
assert Path('/output').read_bytes()[-5:] == bytes([1, 1]) + b'end'
print('files, imports, binary reads, flush, truncate and append passed')
`)};
    function fixture(delayed) {
      const storage = new MemoryFileSystem();
      Object.defineProperty(storage, 'open', { value: undefined });
      const bindings = new Map();
      const events = { acquired: 0, released: 0, largestRead: 0, largestChunk: 0 };
      async function delay(options) {
        options?.signal?.throwIfAborted();
        if (delayed) await new Promise(resolve => setTimeout(resolve, 1));
        options?.signal?.throwIfAborted();
      }
      function snapshot(data, stat, parent) {
        const revision = parent.ino + ':' + stat.ino + ':' + stat.revision;
        bindings.set(revision, { parent, expected: stat });
        events.acquired++;
        let closed = false;
        return { revision, stat, async read(position, count, options) {
          await delay(options);
          assert.equal(closed, false);
          events.largestRead = Math.max(events.largestRead, count);
          return data.slice(position, position + count);
        }, async close() { if (!closed) { closed = true; events.released++; } } };
      }
      const store = {
        async acquire(path, options) {
          await delay(options);
          try {
            const stat = await storage.stat(path, options);
            const data = await storage.readFile(path, options);
            const verified = await storage.stat(path, options);
            if (stat.ino !== verified.ino || stat.revision !== verified.revision) throw new FsError('EAGAIN');
            const parent = await storage.stat(path.slice(0, path.lastIndexOf('/')) || '/', options);
            return snapshot(data, stat, parent);
          } catch (error) {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          }
        },
        async publish(path, revision, source, options) {
          await delay(options);
          const data = new Uint8Array(options.size);
          let offset = 0;
          for await (const chunk of source) {
            options.signal?.throwIfAborted();
            events.largestChunk = Math.max(events.largestChunk, chunk.length);
            data.set(chunk, offset);
            offset += chunk.length;
          }
          assert.equal(offset, options.size);
          const binding = revision === null
            ? { parent: await storage.stat(path.slice(0, path.lastIndexOf('/')) || '/', options), expected: null }
            : bindings.get(revision);
          if (!binding) throw new FsError('EAGAIN');
          const stat = await storage.writeFileConditional(path, data, { ...binding, ...options });
          return snapshot(data, stat, binding.parent);
        },
      };
      return { fs: storage, store, root: '/', events,
        dispose() { assert.equal(events.released, events.acquired); } };
    }
    for (const delayed of [false, true]) {
      for (const entry of createObjectFilePublicationConformanceCases({ createFixture: () => fixture(delayed) })) await entry.run();
      const backend = fixture(delayed);
      await backend.fs.writeFile('/input.txt', encoder.encode('canonical input'));
      await backend.fs.writeFile('/helper.py', encoder.encode('answer = 42'));
      await backend.fs.writeFile('/main.py', encoder.encode(python));
      await backend.fs.writeFile('/binary', Uint8Array.from({ length: 16 * 1024 * 1024 }, (_, index) => index % 256));
      const fs = withObjectFileDescriptors(backend.fs, backend.store, { chunkBytes: 65536, maxStagedBytes: 131072 });
      let retired = 0;
      const shell = new Shell({ fs }).use(pythonCommands({ createWorker() {
        const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
        return { ...endpoint, async terminate() { await endpoint.terminate(); retired++; } };
      } }));
      try {
        const result = await shell.exec('python /main.py');
        assert.equal(result.exitCode, 0, result.stderr);
        assert.match(result.stdout, /append passed/);
        assert.equal((await backend.fs.stat('/output')).size, 65541);
        assert.ok(backend.events.largestRead <= 65536);
        assert.ok(backend.events.largestChunk <= 65536);
        assert.equal(retired, 1);
        console.log((delayed ? 'delayed' : 'flat') + ' passed');
      } finally { await shell.dispose(); backend.dispose(); }
    }
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer, signal: context.signal, timeout: 85000, maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /delayed passed/);
  context.diagnostic(result.stdout.trim());
});
