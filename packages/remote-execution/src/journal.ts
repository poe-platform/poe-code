import { encodeFrame, type BinaryFrame, type BinaryOptions } from './binary.js';
import { UploadError } from './upload-protocol.js';
export interface JournalOptions extends BinaryOptions { maxReplayBytes: number }
/** Bounded process-local replay. Delivery acknowledgement does not establish
 * external sink durability. There is deliberately no lost-state exactly-once claim. */
export function createFrameJournal(options: JournalOptions) {
  // Retention and frame credit are admitted once, independent of configuration
  // carriers a caller may reuse while an append waits for acknowledgment.
  options = { ...options, channels: [...options.channels] };
  if (!Number.isSafeInteger(options.maxReplayBytes) || options.maxReplayBytes < 2 * (40 + options.maxFrameBytes)) throw new TypeError('Invalid replay capacity');
  // Reserve half of the total negotiated replay budget for metadata. Scheduling
  // precedes sequence assignment; blocked data never owns control's credit.
  const capacity={data:Math.floor(options.maxReplayBytes/2),control:Math.ceil(options.maxReplayBytes/2)};
  const retained={data:0,control:0};const queued={data:0,control:0};
  const chains:{data:Promise<unknown>;control:Promise<unknown>}={data:Promise.resolve(),control:Promise.resolve()};
  const channels=[...options.channels]; const admittedOptions={...options,channels};
  const frames = new Map<bigint, { bytes: Uint8Array; offsets: Map<number, bigint>; pool:'data'|'control' }>();
  const offsets = new Map(options.channels.map(c => [c, 0n])); const ends = new Set<number>();
  // Keep only the latest retired boundary. Retrying its lost receipt is safe;
  // older boundaries have expired and cannot establish consumer delivery.
  let acknowledgedOffsets = new Map(offsets);
  let size = 0; let next = 1n; let floor = 1n; let sealed = false; let failure: unknown; let failed = false;
  const waiters = new Set<() => void>();
  function wake() { for (const resolve of waiters) resolve(); waiters.clear(); }
  function changed(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { waiters.delete(done); reject(signal?.reason); };
      waiters.add(done); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
  async function append(kind: BinaryFrame['kind'], channelId: number, payload: Uint8Array, correlationId = 0n, signal?: AbortSignal): Promise<bigint> {
    signal?.throwIfAborted();
    if (failed) throw failure;
    if (sealed) throw new TypeError('Journal is sealed');
    if (!(payload instanceof Uint8Array)) throw new TypeError('Frame exceeds admission');
    const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(payload) as number;
    if(length>options.maxFrameBytes)throw new TypeError('Frame exceeds admission');
    if(kind==='control'&&length>options.maxControlBytes)throw new TypeError('Frame exceeds admission');
    const pool=kind==='control'?'control':'data';
    const retainedBytes = 40 + length;
    if (queued[pool] + retainedBytes > capacity[pool]) throw new TypeError('Pending frames exceed admission');
    queued[pool] += retainedBytes;
    payload = new Uint8Array(payload);
    const work = chains[pool].then(async () => {
      signal?.throwIfAborted();
      if (failed) throw failure; if (sealed) throw new TypeError('Journal is sealed');
      if (payload.length > options.maxFrameBytes) throw new TypeError('Frame exceeds admission');
      if (kind !== 'control' && ends.has(channelId)) throw new TypeError('Channel ended');
      while (retained[pool] + 40 + payload.length > capacity[pool]) { await changed(signal); if (failed) throw failure; if (sealed) throw new TypeError('Journal is sealed'); }
      // ACK can wake the credit wait before cancellation in the same turn.
      // Publication linearizes here, after every asynchronous admission wait.
      signal?.throwIfAborted();
      const offset = kind === 'control' ? 0n : offsets.get(channelId);
      if (offset === undefined || offset + BigInt(payload.length) > 18446744073709551615n) throw new TypeError('Channel offset overflow or unadmitted');
      if (next > 18446744073709551615n) throw new TypeError('Frame sequence overflow');
      const sequence = next;
      const bytes = encodeFrame({ kind, channelId, payload, offset, sequence, correlationId }, admittedOptions);
      if (kind !== 'control') offsets.set(channelId, offset + BigInt(payload.length));
      if (kind === 'end') ends.add(channelId);
      frames.set(next++, { bytes, offsets: new Map(offsets),pool }); size += bytes.length;retained[pool]+=bytes.length; wake(); return sequence;
    });
    const completion = work.finally(() => { queued[pool] -= retainedBytes; });
    chains[pool] = completion.catch(() => {}); return completion;
  }
  function stream(sequence: bigint, signal?: AbortSignal): ReadableStream<Uint8Array> {
    if (sequence < floor) throw new UploadError(410, 'Output replay gap');
    if (sequence > next || sequence < 1n) throw new UploadError(400, 'Invalid replay cursor');
    const controller = new AbortController(); const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    return new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          for (;;) {
            combined.throwIfAborted();
            if (sequence < floor) throw new UploadError(410, 'Output replay gap');
            const frame = frames.get(sequence);
            if (frame) { target.enqueue(frame.bytes.slice()); sequence++; return; }
            if (failed) throw failure; if (sealed) { target.close(); return; }
            await changed(combined);
          }
        } catch (error) { target.error(error); }
      },
      cancel(reason) { controller.abort(reason); },
    }, { highWaterMark: 0 });
  }
  function validateAck(sequence: bigint, cursors?: readonly { channelId: number; offset: string }[]) {
    if (sequence < 0n || sequence >= next) throw new UploadError(400, 'Acknowledgement exceeds admitted frames');
    if (sequence < floor - 1n) throw new UploadError(410, 'Acknowledgement replay gap');
    if (cursors) {
      const recorded = sequence === floor - 1n ? acknowledgedOffsets : frames.get(sequence)?.offsets;
      if (!recorded || cursors.length !== recorded.size || new Set(cursors.map(c => c.channelId)).size !== cursors.length || cursors.some(c => recorded.get(c.channelId) !== BigInt(c.offset))) throw new UploadError(409, 'Acknowledgement offsets conflict');
    }
  }
  function ack(sequence:bigint,cursors?:readonly {channelId:number;offset:string}[]){
    validateAck(sequence,cursors);
    if (sequence >= floor) acknowledgedOffsets = new Map(frames.get(sequence)!.offsets);
    for (const [seq, frame] of frames) if (seq <= sequence) { size -= frame.bytes.length;retained[frame.pool]-=frame.bytes.length; frames.delete(seq); }
    if (sequence >= floor) floor = sequence + 1n; wake();
  }
  return { append, stream, ack, validateAck, openChannel(channelId:number) {
    if(!Number.isInteger(channelId)||channelId<4||channelId>4294967295||offsets.has(channelId)||sealed||failed)throw new TypeError('Invalid channel admission');
    channels.push(channelId);offsets.set(channelId,0n);
  }, seal() { sealed = true; wake(); }, fail(cause: unknown) { failure = cause; failed = true; wake(); },
    get channelsEnded(){return channels.every(id=>ends.has(id));},
    get floor() { return floor; }, get next() { return next; }, get retainedBytes() { return size; },
  };
}
export type FrameJournal = ReturnType<typeof createFrameJournal>;
