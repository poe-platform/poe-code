import { requireThat } from '../executor-preparation-v1/core.mjs';

export function byteInput(specimen, engine) {
  const bytes = Buffer.from(specimen.stdinBase64, 'base64');
  if (engine === 'just-bash') return {
    stdin: bytes.toString('latin1'),
    options: { stdinKind: 'bytes', rawScript: true, replaceEnv: true },
    receipt: { admission: 'byte-tagged-ByteString', inputBase64: bytes.toString('base64'), chunks: 'UNQUALIFIED', dispatch: 'UNQUALIFIED', timers: 'UNQUALIFIED', iteratorCleanup: 'UNQUALIFIED' },
  };
  if (specimen.id !== 'W03') return { stdin: bytes, options: {}, receipt: { admission: 'Uint8Array' } };
  const lengths = specimen.inputChunkLengths;
  requireThat(JSON.stringify(lengths) === '[1,2,1,3]' && bytes.toString('base64') === 'AP9BCg2AAA==', 'W03_LITERAL', specimen.id);
  const receipt = { admission: 'owned-four-chunk-ByteSource', acquire: 0, next: 0, returns: 0, settled: 0, active: 0, yieldedBytes: 0, yieldedLengths: [], timers: 'UNQUALIFIED' };
  let chunkIndex = 0;
  let offset = 0;
  const stdin = { [Symbol.asyncIterator]() {
    receipt.acquire++; receipt.active++;
    let closed = false;
    const close = () => { if (!closed) { closed = true; receipt.active--; receipt.settled++; } };
    return {
      async next() {
        receipt.next++;
        if (closed || chunkIndex === lengths.length) { close(); return { done: true, value: undefined }; }
        const length = lengths[chunkIndex++];
        const value = new Uint8Array(bytes.subarray(offset, offset + length));
        offset += length; receipt.yieldedBytes += length; receipt.yieldedLengths.push(length);
        return { done: false, value };
      },
      async return() { receipt.returns++; close(); return { done: true, value: undefined }; },
    };
  } };
  return { stdin, options: {}, receipt };
}
export function telemetryOutcome(specimen, engine, receipt, dispatches, disposeSettled) {
  if (specimen.id !== 'W03') return null;
  if (engine === 'just-bash') return {
    inputAdmission: { status: 'OBSERVABLE_BYTE_ADMISSION', inputBase64: receipt.inputBase64 },
    chunks: { status: 'UNQUALIFIED', reason: 'Authenticated public adapter admits a byte-tagged scalar, not the four-chunk producer.' },
    dispatch: { status: 'UNQUALIFIED', reason: 'No authenticated public command-dispatch observer in this adapter.' },
    timers: { status: 'UNQUALIFIED', reason: 'No authenticated timeout-timer observer.' },
    iteratorCleanup: { status: 'UNQUALIFIED', reason: 'No caller-owned iterator is supplied by this admission path.' },
  };
  const catCount = dispatches.filter(event => event.command === 'cat').length;
  return {
    inputAdmission: { status: 'OBSERVABLE_CHUNK_ADMISSION', inputBase64: specimen.stdinBase64 },
    chunks: { status: JSON.stringify(receipt.yieldedLengths) === '[1,2,1,3]' && receipt.yieldedBytes === 7 ? 'QUALIFIED' : 'FAILED', receipt },
    dispatch: { status: catCount === 1 ? 'QUALIFIED' : 'FAILED', catCount, events: dispatches },
    timers: { status: 'UNQUALIFIED', reason: 'Default scheduler is unchanged; no injected scheduler or imported node:timers mutation. Zero timers is not newly observed.' },
    iteratorCleanup: { status: disposeSettled && receipt.acquire >= 1 && receipt.active === 0 && receipt.settled === receipt.acquire ? 'QUALIFIED' : 'FAILED', scope: 'Caller-supplied producer only; not opaque provider work.', receipt },
  };
}
