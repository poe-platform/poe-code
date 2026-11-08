export function latch() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

export function createFixture(caseRecord, owner) {
  const files = new Map([['/data/input.json', Buffer.from('{"count":1}')], ['/data/object.json', Buffer.from('{"count":1}')]]);
  const output = [];
  const effectCleanup = latch();
  const invocationCleanup = latch();
  const sinkReason = Object.freeze({ identity: 'selected-sink-reason' });
  const cleanupReason = Object.freeze({ identity: 'selected-cleanup-reason' });
  const objectReason = Object.freeze({ identity: 'selected-caller-reason' });
  const callerReason = caseRecord.reason === 'undefined' ? undefined : caseRecord.reason === 'false' ? false : objectReason;
  if (caseRecord.fixture !== 'L06b') invocationCleanup.release();
  owner.registerCleanup(async () => { await invocationCleanup.promise; if (caseRecord.fixture === 'L06b') throw cleanupReason; });
  owner.afterExit(() => { effectCleanup.release(); invocationCleanup.release(); });
  function cancel() { owner.cancel({ present: true, value: callerReason, provenance: 'caller' }); }
  return {
    kind: 'cooperative-development-map-not-product-FileSystem',
    namespace: 1,
    files,
    output,
    rawReasons: { callerReason, sinkReason, cleanupReason },
    authorize(request) {
      return !(caseRecord.fixture === 'L07' && request.op === 'writeText');
    },
    start(request, bytes, signal) {
      let cleanup = async () => {};
      const result = (async () => {
        if (request.op === 'authorizeModule' || request.op === 'authorizeJson') return null;
        if (request.op === 'readText') {
          if (caseRecord.fixture === 'L05') {
            const aborted = latch();
            const onAbort = () => aborted.release();
            signal.addEventListener('abort', onAbort, { once: true });
            cleanup = async () => { signal.removeEventListener('abort', onAbort); };
            cancel();
            if (signal.aborted) aborted.release();
            await aborted.promise;
            throw signal.reason;
          }
          if (request.authority === 'stdin') return Buffer.from('fixture-stdin');
          if (!files.has(request.path)) throw new Error('DEV_MISSING_NOT_TYPED_FS_ERROR');
          return Uint8Array.from(files.get(request.path));
        }
        if (request.op === 'writeText') {
          if (request.flag === 'wx' && files.has(request.path)) throw new Error('DEV_EXISTS_NOT_TYPED_FS_ERROR');
          files.set(request.path, Uint8Array.from(bytes));
          owner.event('file-effect', request.seq, bytes.length);
          if (caseRecord.fixture === 'L06a') {
            cleanup = async () => { await effectCleanup.promise; };
            cancel();
          }
          return null;
        }
        if (caseRecord.fixture === 'L06b') throw sinkReason;
        output.push(Uint8Array.from(bytes));
        owner.event('output-published', request.seq, bytes.length);
        return null;
      })();
      return { result, close: () => cleanup() };
    }
  };
}
