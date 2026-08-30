import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';

export function createRejectionEncoder() {
  const scope = randomUUID();
  const objects = new WeakMap();
  const symbols = new Map();
  let nextToken = 0;
  const identity = (reason, identities) => {
    if (!identities.has(reason)) identities.set(reason, ++nextToken);
    return { scope, token: identities.get(reason) };
  };
  const describe = (read) => { try { return String(read()); } catch { return '<unprintable>'; } };
  return (reason) => {
    if (reason === undefined) return { kind: 'undefined' };
    if (reason === null) return { kind: 'null' };
    const kind = typeof reason;
    if (['string', 'boolean', 'number', 'bigint'].includes(kind)) return { kind, value: Object.is(reason, -0) ? '-0' : String(reason) };
    if (kind === 'symbol') return { kind, value: String(reason), identity: identity(reason, symbols) };
    return {
      kind, identity: identity(reason, objects),
      name: describe(() => reason.name ?? ''), message: describe(() => reason.message ?? reason),
      code: describe(() => reason.code ?? ''), stack: describe(() => reason.stack ?? ''),
    };
  };
}

export const encodeRejection = createRejectionEncoder();

export function createFixtureContext(job) {
  const events = [];
  const cleanup = [];
  const stdout = [];
  const stderr = [];
  const signal = new AbortController().signal;
  let outputBytes = 0;
  const event = (kind, detail = {}) => {
    assert(events.length < 20000, 'Harness event capture bound');
    events.push({ index: events.length, kind, ...detail });
  };
  const normalize = (filename) => posix.resolve('/v', filename);
  const files = new Map(job.files.map((file) => [normalize(file.path), Buffer.from(file.hex, 'hex')]));
  assert.equal(files.size, job.files.length, 'Duplicate fixture namespace path');
  const snapshot = () => [...files].sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => ({ path, hex: bytes.toString('hex') }));
  const before = snapshot();
  const makeSource = (chunks, name, reuse = false) => ({
    [Symbol.asyncIterator]() {
      event('iterator-acquire', { name });
      let offset = 0;
      let returned = false;
      const reusable = new Uint8Array(Math.max(0, ...chunks.map((chunk) => chunk.length)));
      const finish = () => { if (reuse) reusable.fill(0x78); };
      return {
        async next() {
          event('iterator-next', { name, offset });
          if (returned || offset === chunks.length) { finish(); return { done: true, value: undefined }; }
          const bytes = chunks[offset++];
          if (reuse) { reusable.fill(0x78); reusable.set(bytes); return { done: false, value: reusable.subarray(0, bytes.length) }; }
          return { done: false, value: new Uint8Array(bytes) };
        },
        async return() { returned = true; finish(); event('iterator-return', { name }); return { done: true, value: undefined }; },
      };
    },
  });
  const take = (filename, options, operation) => {
    event('fs-read', { operation, path: filename, signalIsContext: options?.signal === signal });
    const bytes = files.get(normalize(filename));
    assert(bytes !== undefined, `Unbound fixture file: ${filename}`);
    return new Uint8Array(bytes);
  };
  const fs = {
    capabilities: Object.freeze({ readOnly: true, streamingRead: true }),
    async readFile(filename, options) { return take(filename, options, 'readFile'); },
    readStream(filename, options) { return makeSource([take(filename, options, 'readStream')], filename); },
  };
  for (const method of ['writeFile', 'appendFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'realpath', 'access', 'readlink', 'symlink', 'link', 'chmod', 'utimes', 'truncate', 'writeStream']) {
    fs[method] = async (...args) => { event('unbound-fs-operation', { method, path: String(args[0]) }); throw new Error(`Unbound fixture FS operation: ${method}`); };
  }
  const sink = (name, chunks) => ({
    async write(bytes) {
      assert(bytes instanceof Uint8Array, 'Byte sink payload');
      assert(outputBytes + bytes.length <= 2097152, 'Harness command output capture bound');
      outputBytes += bytes.length;
      chunks.push(Buffer.from(bytes));
      event('sink-write', { name, bytes: bytes.length });
    },
  });
  const context = {
    command: 'yq', args: [...job.argv], stdin: makeSource(job.stdinChunksHex.map((hex) => Buffer.from(hex, 'hex')), '<stdin>', job.producerReuse),
    stdinIsDefault: job.stdinIsDefault, stdout: sink('stdout', stdout), stderr: sink('stderr', stderr),
    cwd: '/v', env: {}, fs, signal,
    registerCleanup(callback) { assert.equal(typeof callback, 'function'); event('register-cleanup'); cleanup.push(callback); },
  };
  return {
    context, event,
    async drain() {
      const errors = [];
      for (const callback of cleanup) {
        try { await callback(); } catch (error) { errors.push(encodeRejection(error)); }
      }
      return errors;
    },
    capture() { return { stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex'), effects: { before, after: snapshot() }, events }; },
  };
}
