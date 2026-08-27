import assert from 'node:assert/strict';
import { posix } from 'node:path';

export function fixtureFs(entry, FsError, trace) {
  const identityScope = {};
  const entries = new Map(entry.entries.map((item, index) => [item.path, { ...item, inode: index + 1 }]));
  const fail = (code, path) => { throw new FsError(code, { path, syscall: 'independent-safety-fixture' }); };
  const record = (method, path, options) => {
    assert(trace.calls.length < 1024, 'bounded VFS telemetry');
    trace.calls.push({ method, path, signalPresent: options?.signal instanceof AbortSignal, signalAbortedAtEntry: options?.signal?.aborted === true });
    assert(options?.signal instanceof AbortSignal, 'actual VFS signal required');
    options.signal.throwIfAborted();
  };
  const lookup = path => entries.get(posix.resolve('/', path)) ?? fail('ENOENT', path);
  const stat = item => ({ type: item.type, size: item.type === 'file' ? Buffer.from(item.base64, 'base64').length : item.type === 'symlink' ? Buffer.byteLength(item.target) : 0,
    mode: item.type === 'directory' ? 0o755 : 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, identityScope, dev: 1, ino: item.inode });
  const fs = {
    capabilities: { readOnly: true, symlinks: true, streamingRead: true },
    async lstat(path, options) { record('lstat', path, options); return stat(lookup(path)); },
    async stat(path, options) {
      record('stat', path, options);
      const item = lookup(path);
      if (item.type === 'symlink') return stat(lookup(posix.resolve(posix.dirname(path), item.target)));
      return stat(item);
    },
    async readdir(path, options) {
      record('readdir', path, options);
      if (lookup(path).type !== 'directory') return fail('ENOTDIR', path);
      return [...entries.values()].filter(item => item.path !== path && posix.dirname(item.path) === path).map(item => ({ name: posix.basename(item.path), type: item.type }));
    },
    async readlink(path, options) {
      record('readlink', path, options);
      const item = lookup(path);
      if (item.type !== 'symlink') return fail('EINVAL', path);
      return item.target;
    },
    async readFile(path, options) { record('readFile', path, options); throw new Error('Streaming safety fixtures must not fall back to readFile'); },
    readStream(path, options) {
      record('readStream', path, options);
      assert.equal(options.start, 0);
      assert(Number.isSafeInteger(options.endExclusive) && options.endExclusive > 0 && options.endExclusive <= entry.limits.maxSniffBytes);
      assert(Number.isSafeInteger(options.chunkSize) && options.chunkSize > 0 && options.chunkSize <= entry.limits.maxChunkBytes);
      const item = lookup(path);
      if (item.type !== 'file') return fail('EISDIR', path);
      const bytes = Buffer.from(item.base64, 'base64');
      const stream = { path, start: options.start, endExclusive: options.endExclusive, chunkSize: options.chunkSize, next: 0, returned: 0, bytes: 0 };
      trace.streams.push(stream);
      let offset = 0;
      const end = Math.min(bytes.length, options.endExclusive);
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          stream.next++;
          assert(stream.next <= 66, 'bounded producer-next calls');
          options.signal.throwIfAborted();
          if (offset === end) return { done: true, value: undefined };
          const width = Math.min(entry.chunkBytes ?? 1024, options.chunkSize, end - offset);
          const value = new Uint8Array(bytes.subarray(offset, offset + width));
          offset += width;
          stream.bytes += width;
          return { done: false, value };
        },
        async return() { stream.returned++; return { done: true, value: undefined }; },
      };
    },
    async realpath(path, options) { record('realpath', path, options); lookup(path); return posix.resolve('/', path); },
  };
  for (const method of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'writeStream', 'symlink', 'link', 'chmod', 'utimes', 'truncate']) {
    fs[method] = async () => { trace.mutations++; throw new Error(`Forbidden fixture mutation ${method}`); };
  }
  return fs;
}
