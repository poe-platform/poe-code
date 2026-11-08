import assert from 'node:assert/strict';
import { open, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoryFileSystem, FsError } from '../../src/core.ts';

export function createDiskStagingFixture(root, { chunkBytes, delayed, spill }) {
  const memory = new MemoryFileSystem();
  const files = new Map();
  const events = { acquired: 0, released: 0, created: 0, closed: 0, publications: 0,
    publishedBytes: 0, stageWriteBytes: 0, stageReadBytes: 0, activeWrites: 0,
    peakWrites: 0, largestChunk: 0, largestRead: 0 };
  let generation = 0;
  async function pause(options) {
    options?.signal?.throwIfAborted();
    if (delayed) await new Promise(resolve => setTimeout(resolve, 1));
    options?.signal?.throwIfAborted();
  }
  async function lease(file) {
    const handle = file.diskPath && await open(file.diskPath, 'r');
    events.acquired++;
    let closed = false;
    return { revision: file.revision, stat: file.stat,
      async read(position, count, options) {
        await pause(options);
        assert.equal(closed, false);
        assert.ok(count <= chunkBytes);
        events.largestRead = Math.max(events.largestRead, count);
        if (!handle) return file.bytes.slice(position, position + count);
        const bytes = new Uint8Array(count);
        let offset = 0;
        while (offset < count) {
          const result = await handle.read(bytes, offset, count - offset, position + offset);
          assert.ok(result.bytesRead > 0);
          offset += result.bytesRead;
        }
        return bytes;
      },
      async close() {
        if (closed) return;
        closed = true;
        await handle?.close();
        events.released++;
      },
    };
  }
  const store = {
    async acquire(path, options) {
      await pause(options);
      if (files.has(path)) return lease(files.get(path));
      try {
        const stat = await memory.stat(path, options);
        const bytes = await memory.readFile(path, options);
        return lease({ stat, bytes, revision: `script:${stat.ino}:${stat.revision}` });
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async publish(path, expected, source, options) {
      await pause(options);
      const revision = String(++generation);
      const diskPath = join(root, `version-${revision}`);
      const handle = await open(diskPath, 'wx');
      let size = 0;
      try {
        for await (const chunk of source) {
          await pause(options);
          assert.ok(chunk.length <= chunkBytes);
          events.largestChunk = Math.max(events.largestChunk, chunk.length);
          let offset = 0;
          while (offset < chunk.length) {
            const result = await handle.write(chunk, offset, chunk.length - offset, size + offset);
            assert.ok(result.bytesWritten > 0);
            offset += result.bytesWritten;
          }
          size += chunk.length;
        }
      } finally { await handle.close(); }
      assert.equal(size, options.size);
      options.signal?.throwIfAborted();
      if ((files.get(path)?.revision ?? null) !== expected) throw new FsError('EAGAIN');
      const file = { diskPath, revision, stat: { type: 'file', size, mode: options.mode ?? 0o644,
        ino: generation, revision: generation, dev: 1, mtimeMs: generation, atimeMs: generation, ctimeMs: generation } };
      files.set(path, file);
      events.publications++;
      events.publishedBytes += size;
      return lease(file);
    },
  };
  if (spill) store.createStaging = async (path, options) => {
    await pause(options);
    assert.equal(options.chunkBytes, chunkBytes);
    const directory = join(root, `stage-${++events.created}`);
    await mkdir(directory);
    const pages = new Set();
    let closed = false;
    return {
      async readPage(index, forwarded) {
        await pause(forwarded);
        assert.equal(closed, false);
        if (!pages.has(index)) return undefined;
        const bytes = await readFile(join(directory, String(index)));
        assert.equal(bytes.length, chunkBytes);
        events.stageReadBytes += bytes.length;
        return bytes;
      },
      async writePage(index, bytes, forwarded) {
        assert.equal(closed, false);
        assert.equal(bytes.length, chunkBytes);
        events.activeWrites++;
        events.peakWrites = Math.max(events.peakWrites, events.activeWrites);
        try {
          await pause(forwarded);
          assert.equal(files.get(path)?.stat.size, 0, 'spill pages must remain unpublished');
          await writeFile(join(directory, String(index)), bytes, { signal: forwarded?.signal });
          pages.add(index);
          events.stageWriteBytes += bytes.length;
        } finally { events.activeWrites--; }
      },
      async truncate(size, forwarded) {
        await pause(forwarded);
        assert.equal(closed, false);
        for (const index of pages) {
          const pagePath = join(directory, String(index));
          if (index * chunkBytes >= size) {
            await rm(pagePath);
            pages.delete(index);
          } else if ((index + 1) * chunkBytes > size) {
            const bytes = await readFile(pagePath);
            bytes.fill(0, size % chunkBytes);
            await writeFile(pagePath, bytes, { signal: forwarded?.signal });
          }
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        await rm(directory, { recursive: true });
        events.closed++;
      },
    };
  };
  const fs = new Proxy(memory, { get(target, property) {
    if (property === 'open' || property === 'openReadFile') return undefined;
    if (property === 'stat' || property === 'lstat') return async (path, options) => {
      options?.signal?.throwIfAborted();
      return files.get(path)?.stat ?? target[property](path, options);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { fs, store, events, files };
}
