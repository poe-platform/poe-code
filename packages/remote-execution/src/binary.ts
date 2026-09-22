/** Portable codec for the normative REX1 schema. No Node globals or media text. */
import {parseWireJson} from './wire-json.js';
export const binaryContentType = 'application/vnd.poe.remote-execution.v1+octet-stream';
export interface BinaryFrame {
  kind: 'data' | 'end' | 'control'; channelId: number; sequence: bigint;
  offset: bigint; correlationId: bigint; payload: Uint8Array;
}
export interface BinaryOptions {
  maxFrameBytes: number; maxControlBytes: number; channels: readonly number[];
  requireEnd?: boolean; maxTotalBytes?:number; firstSequence?: bigint;
  maxChannels?:number;channelOpenDirection?:'read'|'write';endedChannels?:readonly number[];
  offsets?: ReadonlyMap<number, bigint>;
  /** Mandatory for CONTROL: validate the negotiated control schema strictly. */
  validateControl?: (value: unknown) => void;
}
function bounds(options: BinaryOptions) {
  for (const n of [options.maxFrameBytes, options.maxControlBytes]) if (!Number.isSafeInteger(n) || n < 1 || n > 1048576) throw new TypeError('Invalid frame bound');
  if(options.maxChannels!==undefined&&(!Number.isSafeInteger(options.maxChannels)||options.maxChannels<options.channels.length))throw new TypeError('Invalid channel capacity');
  if(options.endedChannels?.some(id=>!options.channels.includes(id)))throw new TypeError('Invalid ended channel');
  if(options.maxTotalBytes!==undefined && (!Number.isSafeInteger(options.maxTotalBytes)||options.maxTotalBytes<0))throw new TypeError('Invalid lane bound');
  if (options.maxControlBytes > options.maxFrameBytes || options.channels.some(n => !Number.isInteger(n) || n < 1 || n > 4294967295)) throw new TypeError('Invalid channel bound');
}
function uint64(n: bigint) { if (typeof n !== 'bigint' || n < 0n || n > 18446744073709551615n) throw new TypeError('Invalid uint64'); }
function header(bytes: Uint8Array, options: BinaryOptions): Omit<BinaryFrame, 'payload'> & { length: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 40);
  if (view.getUint32(0) !== 0x52455831 || view.getUint8(4) !== 1 || view.getUint16(6) !== 0) throw new TypeError('Invalid frame magic/version/reserved bits');
  const kind = ({ 1: 'data', 2: 'end', 3: 'control' } as const)[view.getUint8(5) as 1 | 2 | 3];
  const channelId = view.getUint32(8); const length = view.getUint32(12);
  const sequence = view.getBigUint64(16); const offset = view.getBigUint64(24); const correlationId = view.getBigUint64(32);
  if (!kind || sequence === 0n) throw new TypeError('Invalid frame kind/sequence');
  if (length > options.maxFrameBytes || (kind === 'control' && length > options.maxControlBytes)) throw new TypeError('Invalid frame length');
  if (kind === 'control' ? channelId !== 0 || offset !== 0n : !options.channels.includes(channelId)) throw new TypeError('Invalid frame channel/offset');
  if (kind === 'end' && length !== 0) throw new TypeError('END must have zero length');
  if (offset + BigInt(length) > 18446744073709551615n) throw new TypeError('Channel offset overflow');
  return { kind, channelId, length, sequence, offset, correlationId };
}
function control(frame: BinaryFrame, options: BinaryOptions):unknown {
  if (frame.kind !== 'control') return;
  if (!options.validateControl) throw new TypeError('CONTROL schema is not negotiated');
  const record=parseWireJson(new TextDecoder('utf-8', { fatal: true }).decode(frame.payload));options.validateControl(record);return record;
}
export function encodeFrame(frame: BinaryFrame, options: BinaryOptions): Uint8Array {
  frame={kind:frame.kind,channelId:frame.channelId,sequence:frame.sequence,offset:frame.offset,correlationId:frame.correlationId,payload:frame.payload};
  bounds(options);
  for (const n of [frame.sequence, frame.offset, frame.correlationId]) uint64(n);
  if (!Number.isInteger(frame.channelId) || frame.channelId < 0 || frame.channelId > 4294967295 || !(frame.payload instanceof Uint8Array)) throw new TypeError('Invalid frame');
  // Validate size before making a retained copy.
  const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(frame.payload) as number;
  if (length > options.maxFrameBytes) throw new TypeError('Invalid frame length');
  // A fixed header admits kind, channel, control size and counters before
  // allocating the payload-bearing frame.
  const raw = new Uint8Array(40); const view = new DataView(raw.buffer);
  view.setUint32(0, 0x52455831); view.setUint8(4, 1); view.setUint8(5, { data: 1, end: 2, control: 3 }[frame.kind]);
  view.setUint32(8, frame.channelId); view.setUint32(12, length);
  view.setBigUint64(16, frame.sequence); view.setBigUint64(24, frame.offset); view.setBigUint64(32, frame.correlationId);
  header(raw, options); control(frame, options);
  const wire = new Uint8Array(40 + length); wire.set(raw); wire.set(frame.payload, 40); return wire;
}
/** One header and one admitted payload in memory. The producer is advanced only
 * after yielding the owned frame. Interrupted frames never yield or acknowledge.
 * Offset/sequence state advances only when the consumer resumes after delivery. */
export async function* decodeFrames(source: ReadableStream<Uint8Array>, options: BinaryOptions, signal?: AbortSignal): AsyncGenerator<BinaryFrame> {
  signal?.throwIfAborted();
  // Retain every negotiated capability before yielding to transport or delivery.
  // Caller mutation cannot widen budgets, replace validation or waive END.
  options = { ...options };
  bounds(options);
  options = { ...options, channels: [...options.channels],
    endedChannels: options.endedChannels ? [...options.endedChannels] : undefined,
    offsets: options.offsets ? new Map(options.offsets) : undefined };
  const channels=[...options.channels];const admittedOptions={...options,channels};
  let chunk: Uint8Array = new Uint8Array(); let position = 0; let chunkLength=0;let sequence = options.firstSequence ?? 1n;
  const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
  const byteLength=Object.getOwnPropertyDescriptor(typedArray,'byteLength')!.get!;
  const buffer=Object.getOwnPropertyDescriptor(typedArray,'buffer')!.get!;
  const byteOffset=Object.getOwnPropertyDescriptor(typedArray,'byteOffset')!.get!;
  uint64(sequence);
  let totalBytes=0;
  const offsets = new Map(options.channels.map(id => [id, options.offsets?.get(id) ?? 0n])); const ended = new Set<number>(options.endedChannels);
  const reader = source.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  async function fill(target: Uint8Array): Promise<boolean> {
    let filled = 0;
    while (filled < target.length) {
      signal?.throwIfAborted();
      if (position === chunkLength) {
        const next = await reader.read();
        signal?.throwIfAborted();
        if (next.done) { if (filled) throw new TypeError('Interrupted binary frame'); return false; }
        if(!(next.value instanceof Uint8Array))throw new TypeError('Binary transport bytes required');
        chunk = next.value;chunkLength=byteLength.call(chunk) as number;position = 0; if (!chunkLength) continue;
      }
      const count = Math.min(chunkLength - position, target.length - filled);
      target.set(new Uint8Array(buffer.call(chunk) as ArrayBuffer,(byteOffset.call(chunk) as number)+position,count), filled); filled += count; position += count;
    }
    return true;
  }
  try {
    for (;;) {
      const raw = new Uint8Array(40); if (!await fill(raw)) break;
      const parsed = header(raw, admittedOptions);
      totalBytes+=40+parsed.length;if(totalBytes>(options.maxTotalBytes??Infinity))throw new TypeError('Lane byte length exceeds admission');
      if (parsed.sequence !== sequence) throw new TypeError('Noncontiguous frame sequence');
      if (parsed.kind !== 'control' && (ended.has(parsed.channelId) || parsed.offset !== offsets.get(parsed.channelId))) throw new TypeError('Invalid channel END/offset');
      const payload = new Uint8Array(parsed.length);
      if (!await fill(payload)) throw new TypeError('Interrupted binary frame');
      const { length: ignoredLength, ...fields } = parsed; const frame = { ...fields, payload };const record=control(frame, options)as {type?:string;direction?:string;channelId?:number}|undefined;
      if(record?.type==='ChannelOpen' && record.direction===options.channelOpenDirection){const id=record.channelId;if(!Number.isInteger(id)||id!<4||id!>4294967295||channels.includes(id!)||channels.length>=(options.maxChannels??options.channels.length))throw new TypeError('Invalid dynamic channel admission');channels.push(id!);offsets.set(id!,0n);}
      signal?.throwIfAborted();
      yield frame;
      sequence++;
      if (parsed.kind !== 'control') offsets.set(parsed.channelId, parsed.offset + BigInt(parsed.length));
      if (parsed.kind === 'end') ended.add(parsed.channelId);
    }
    if (options.requireEnd && channels.some(id => !ended.has(id))) throw new TypeError('Transport EOF without END');
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
