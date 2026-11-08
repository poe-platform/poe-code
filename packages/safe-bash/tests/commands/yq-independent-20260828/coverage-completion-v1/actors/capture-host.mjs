import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { describeReason } from './own-data.mjs';

export function createRecorder(limits, began) {
  const events = [];
  const stdout = [];
  const stderr = [];
  const sizes = { stdout: 0, stderr: 0, metadata: 65536 };
  let failure;
  const fail = code => {
    failure ??= new Error(code);
    throw failure;
  };
  const guard = () => {
    if (failure) throw failure;
    if (performance.now() - began >= limits.wallMs) fail('ACTOR_OBSERVED_DEADLINE');
  };
  const event = (kind, detail = {}) => {
    guard();
    const row = { index: events.length, kind, ...detail };
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (events.length >= limits.events - 2 || bytes > limits.metadataBytes - sizes.metadata - 2048) fail('ACTOR_METADATA_OVERFLOW');
    sizes.metadata += bytes;
    events.push(row);
  };
  const write = (name, bytes, acceptedLength = bytes.byteLength) => {
    guard();
    if (!types.isUint8Array(bytes)) fail('ACTOR_NON_BYTE_OUTPUT');
    const available = Math.max(0, Math.min(limits[`${name}Bytes`] - sizes[name], 2097152 - sizes.stdout - sizes.stderr));
    const accepted = Math.min(acceptedLength, available);
    if (accepted > 0) {
      const owned = Buffer.from(bytes.subarray(0, accepted));
      (name === 'stdout' ? stdout : stderr).push(owned);
      sizes[name] += owned.length;
    }
    event('sink-bytes-retained', { name, attempted: bytes.byteLength, accepted });
    if (accepted < acceptedLength) fail('ACTOR_OUTPUT_OVERFLOW');
  };
  return {
    event, guard, write,
    reserveMetadata(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limits.metadataBytes - sizes.metadata - 2048) fail('ACTOR_METADATA_RESERVATION');
      sizes.metadata += bytes;
    },
    failure: () => failure,
    finish() {
      if (performance.now() - began >= limits.wallMs) failure ??= new Error('ACTOR_OBSERVED_DEADLINE');
      events.push({ index: events.length, kind: 'actor-terminal', captureComplete: failure === undefined, elapsedMs: performance.now() - began });
      return { stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex'), events, captureComplete: failure === undefined };
    },
  };
}

export function createCommandHost(fixture, recorder, limits) {
  const controller = new AbortController();
  const callerReason = { code: 'ENOENT' };
  const hostReason = { role: 'actor-host-read-failure' };
  const cleanupReason = { role: 'actor-cooperative-return-failure' };
  const sinkReason = { code: 'EPIPE' };
  const callbacks = [];
  const cleanupErrors = [];
  const pending = [];
  const local = { callerReason, hostReason, cleanupReason, sinkReason, cleanupReasons: [], selectedReason: undefined, hasSelectedReason: false };
  const paths = [...new Set(fixture.files.map(filename => posix.resolve('/v', filename)))];
  const fileBytes = Buffer.from(fixture.fileContents ?? '');
  const before = paths.map(path => ({ path, hex: fileBytes.toString('hex') }));
  recorder.reserveMetadata(Buffer.byteLength(JSON.stringify(before)) * 2);
  let overlapStarted = false;
  let writeCount = 0;
  let returned = 0;
  const source = (chunks, name, reuse) => ({
    [Symbol.asyncIterator]() {
      recorder.event('iterator-acquire', { name });
      let offset = 0;
      let closed = false;
      const reusable = new Uint8Array(reuse ? 2 : 0);
      return {
        async next() {
          recorder.event('iterator-next', { name, offset });
          if (fixture.overlapCleanup && !overlapStarted && callbacks.length) {
            overlapStarted = true;
            const first = callbacks[0]();
            const second = callbacks[0]();
            recorder.event('overlapping-cleanup', { samePromise: first === second });
            pending.push(Promise.allSettled([first, second]));
          }
          if (fixture.sourceFailure && !closed) {
            if (fixture.callerAbort) controller.abort(callerReason);
            recorder.event('source-reject', { callerAborted: controller.signal.aborted });
            throw hostReason;
          }
          if (closed || offset >= chunks.length) {
            if (reuse) { reusable.fill(0x78); recorder.event('producer-overwrite', { name, stage: 'terminal-next', hex: Buffer.from(reusable).toString('hex') }); }
            return { done: true, value: undefined };
          }
          const bytes = chunks[offset++];
          if (reuse) {
            reusable.fill(0x78);
            recorder.event('producer-overwrite', { name, stage: 'before-yield', offset: offset - 1, hex: Buffer.from(reusable).toString('hex') });
            reusable.set(bytes);
            return { done: false, value: reusable.subarray(0, bytes.length) };
          }
          return { done: false, value: new Uint8Array(bytes) };
        },
        return() {
          const completion = (async () => {
            closed = true;
            returned++;
            if (reuse) reusable.fill(0x78);
            recorder.event('iterator-return', { name, returned });
            if (fixture.lateReturn) { await Promise.resolve(); await Promise.resolve(); recorder.event('late-return-release', { name }); }
            if (fixture.cleanupFailure) {
              local.cleanupReasons.push(cleanupReason);
              cleanupErrors.push(describeReason(cleanupReason));
              recorder.event('iterator-return-reject', { name });
              throw cleanupReason;
            }
            return { done: true, value: undefined };
          })();
          pending.push(Promise.allSettled([completion]));
          return completion;
        },
      };
    },
  });
  const read = (path, options, operation) => {
    if (typeof path !== 'string' || path.length > 70000) throw new TypeError('literal bounded VFS path required');
    recorder.event('fs-read', { operation, path, signalIsContext: options?.signal === controller.signal });
    if (!paths.includes(path)) throw new Error('UNBOUND_ACTOR_VFS_PATH');
    return new Uint8Array(fileBytes);
  };
  const fs = {
    capabilities: { readOnly: true, streamingRead: true },
    readStream(path, options) { return source([read(path, options, 'readStream')], path, false); },
    async readFile(path, options) { return read(path, options, 'readFile'); },
  };
  for (const method of ['writeFile', 'appendFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'realpath', 'access', 'readlink', 'symlink', 'link', 'chmod', 'utimes', 'truncate', 'writeStream']) fs[method] = async () => { recorder.event('unbound-fs-operation', { method }); throw new Error('UNBOUND_ACTOR_FS_OPERATION'); };
  const sink = name => ({
    async write(bytes) {
      recorder.event('sink-write-begin', { name, bytes: types.isUint8Array(bytes) ? bytes.byteLength : -1 });
      if (fixture.delayedWrite && name === 'stdout' && writeCount++ === 0) { await Promise.resolve(); await Promise.resolve(); recorder.event('write-gate-release', { name }); }
      if (fixture.sinkFailure && name === 'stdout') {
        const accepted = fixture.sinkFailure === 'zero' ? 0 : fixture.sinkFailure === 'prefix' ? Math.min(1, bytes.byteLength) : bytes.byteLength;
        recorder.write(name, bytes, accepted);
        recorder.event('sink-reject', { name, accepted });
        throw sinkReason;
      }
      recorder.write(name, bytes);
      recorder.event('sink-write-end', { name });
    },
  });
  const context = { command: 'yq', args: fixture.argv, stdin: source(fixture.chunks, '<stdin>', fixture.reuse), stdinIsDefault: false, stdout: sink('stdout'), stderr: sink('stderr'), cwd: '/v', env: {}, fs, signal: controller.signal };
  if (!fixture.omitRegistration) context.registerCleanup = callback => {
    if (typeof callback !== 'function' || callbacks.length >= 32) throw new TypeError('bounded cleanup callback required');
    recorder.event('register-cleanup', { ordinal: callbacks.length });
    callbacks.push(callback);
  };
  const inputBytes = fixture.chunks.reduce((total, bytes) => total + bytes.length, 0);
  if (inputBytes > limits.storageBytes || Buffer.byteLength(JSON.stringify(before)) > limits.metadataBytes / 2) throw new RangeError('ACTOR_FIXTURE_STORAGE_LIMIT');
  const digest = createHash('sha256');
  for (const bytes of fixture.chunks) digest.update(bytes);
  return {
    context, local, cleanupErrors,
    inputFacts: { argvEntries: fixture.argv.length, argvUtf8Bytes: fixture.argv.reduce((total, argument) => total + Buffer.byteLength(argument), 0), argvSha256: createHash('sha256').update(JSON.stringify(fixture.argv)).digest('hex'), inputBytes, inputSha256: digest.digest('hex'), chunkBytes: fixture.chunks.map(bytes => bytes.length), producerReuse: fixture.reuse },
    async drain() {
      for (const callback of callbacks) {
        try { recorder.event('host-drain-cleanup'); } catch {}
        try { await callback(); }
        catch (reason) { cleanupErrors.push(describeReason(reason)); local.cleanupReasons.push(reason); }
      }
      await Promise.allSettled(pending);
    },
    effects() { return { before, after: paths.map(path => ({ path, hex: fileBytes.toString('hex') })) }; },
  };
}
