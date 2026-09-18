import { MemoryFileSystem, FsError } from '@poe-code/safe-fs/core';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function createR2StagingFixture(bucket, { chunkBytes, delayed, spill }) {
  const memory = new MemoryFileSystem();
  const files = new Map();
  const prefix = `${crypto.randomUUID()}/`;
  const events = { acquired: 0, released: 0, created: 0, closed: 0, publications: 0,
    stageWriteBytes: 0, stageReadBytes: 0, publishedBytes: 0, largestChunk: 0,
    activeWrites: 0, peakWrites: 0 };
  let generation = 0;
  async function pause(options) {
    options?.signal?.throwIfAborted();
    if (delayed) await new Promise(resolve => setTimeout(resolve, 1));
    options?.signal?.throwIfAborted();
  }
  async function* keys(selectedPrefix) {
    let cursor;
    do {
      const page = await bucket.list({ prefix: selectedPrefix, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const object of page.objects) yield object.key;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  function lease(file) {
    events.acquired++;
    let closed = false;
    return { revision: file.revision, stat: file.stat,
      async read(position, count, options) {
        await pause(options);
        check(!closed && count <= chunkBytes, 'invalid immutable read');
        if (file.bytes) return file.bytes.slice(position, position + count);
        const object = await bucket.get(file.key, { range: { offset: position, length: count } });
        const bytes = new Uint8Array(await object.arrayBuffer());
        check(bytes.length === count, 'short immutable read');
        options?.signal?.throwIfAborted();
        return bytes;
      },
      async close() { if (!closed) { closed = true; events.released++; } },
    };
  }
  const store = {
    async acquire(path, options) {
      await pause(options);
      if (files.has(path)) return lease(files.get(path));
      try {
        const stat = await memory.stat(path, options);
        return lease({ stat, bytes: await memory.readFile(path, options), revision: `script:${stat.ino}` });
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async publish(path, expected, source, options) {
      await pause(options);
      const revision = String(++generation);
      const key = `${prefix}version-${revision}`;
      const stream = new globalThis.FixedLengthStream(options.size);
      const writer = stream.writable.getWriter();
      const upload = bucket.put(key, stream.readable);
      const pump = (async () => {
        let size = 0;
        try {
          for await (const chunk of source) {
            await pause(options);
            check(chunk.length <= chunkBytes, 'oversized publication chunk');
            events.largestChunk = Math.max(events.largestChunk, chunk.length);
            await writer.write(chunk);
            size += chunk.length;
          }
          check(size === options.size, 'incomplete publication');
          await writer.close();
        } catch (error) { await writer.abort(error); throw error; }
      })();
      const outcomes = await Promise.allSettled([upload, pump]);
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
      options.signal?.throwIfAborted();
      if ((files.get(path)?.revision ?? null) !== expected) throw new FsError('EAGAIN');
      const file = { key, revision, stat: { type: 'file', size: options.size, mode: options.mode ?? 0o644,
        ino: generation, revision: generation, dev: 1, mtimeMs: generation, atimeMs: generation, ctimeMs: generation } };
      files.set(path, file);
      events.publications++;
      events.publishedBytes += options.size;
      return lease(file);
    },
  };
  if (spill) store.createStaging = async (path, options) => {
    await pause(options);
    check(options.chunkBytes === chunkBytes, 'wrong page configuration');
    const stagePrefix = `${prefix}stage-${++events.created}/`;
    let closing;
    return {
      async readPage(index, forwarded) {
        await pause(forwarded);
        check(!closing, 'stage closed');
        const object = await bucket.get(`${stagePrefix}${index}`);
        if (!object) return undefined;
        const bytes = new Uint8Array(await object.arrayBuffer());
        check(bytes.length === chunkBytes, 'wrong stored page length');
        events.stageReadBytes += bytes.length;
        forwarded?.signal?.throwIfAborted();
        return bytes;
      },
      async writePage(index, bytes, forwarded) {
        check(!closing && bytes.length === chunkBytes, 'invalid spill write');
        events.activeWrites++;
        events.peakWrites = Math.max(events.peakWrites, events.activeWrites);
        try {
          await pause(forwarded);
          check(files.get(path)?.stat.size === 0, 'premature namespace publication');
          await bucket.put(`${stagePrefix}${index}`, bytes);
          events.stageWriteBytes += bytes.length;
          forwarded?.signal?.throwIfAborted();
        } finally { events.activeWrites--; }
      },
      async truncate(size, forwarded) {
        await pause(forwarded);
        check(!closing, 'stage closed');
        for await (const key of keys(stagePrefix)) {
          forwarded?.signal?.throwIfAborted();
          const index = Number(key.slice(stagePrefix.length));
          if (index * chunkBytes >= size) await bucket.delete(key);
          else if ((index + 1) * chunkBytes > size) {
            const object = await bucket.get(key);
            const bytes = new Uint8Array(await object.arrayBuffer());
            bytes.fill(0, size % chunkBytes);
            await bucket.put(key, bytes);
          }
        }
      },
      close() {
        return closing ??= (async () => {
          for await (const key of keys(stagePrefix)) await bucket.delete(key);
          events.closed++;
        })();
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
  return { fs, store, events, files, async dispose() {
    check(events.acquired === events.released, 'version lease leak');
    check(events.created === events.closed, 'stage lifetime leak');
    for await (const key of keys(prefix)) {
      check(!key.slice(prefix.length).startsWith('stage-'), 'private R2 page leak');
      await bucket.delete(key);
    }
    check((await bucket.list({ prefix })).objects.length === 0, 'fixture cleanup incomplete');
  } };
}
