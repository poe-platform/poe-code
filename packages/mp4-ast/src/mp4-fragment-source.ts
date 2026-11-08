import { BinaryReader } from './binary.js';
import { scanMp4Boxes, type Mp4BoxScanOptions } from './mp4-source.js';
import { consumeMp4SampleSteps, readMp4SampleRange, type Mp4SampleSteps, type Mp4SampleSpan, type Mp4SampleScanOptions, type Mp4TableRange } from './mp4-sample-source.js';
import type { MediaProbeSource } from './types.js';

export interface Mp4FragmentDefaults {
  readonly defaultSampleDescriptionIndex: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
}
export interface Mp4FragmentState { readonly dts: number; readonly sampleCount: number }
export interface Mp4FragmentScanOptions extends Omit<Mp4SampleScanOptions, 'syncSamples'> {
  readonly trackId: number;
  readonly moofOffset: number;
  readonly defaults: Mp4FragmentDefaults;
  /** Carry the end of the last retained sample and count across classic tables and fragments. */
  readonly state?: Mp4FragmentState;
}
interface FragmentHeader extends Mp4FragmentDefaults { readonly baseDataOffset: number }

/** Shared header interpretation, including the resident reader's truncated-field zeros. */
export function mp4FragmentHeader(bytes: Uint8Array, options: Mp4FragmentScanOptions): FragmentHeader | undefined {
  if (bytes.length < 8) return;
  const reader = new BinaryReader(bytes); reader.readU8();
  const flags = reader.readU24BE(), trackId = reader.readU32BE();
  if (trackId !== options.trackId) return;
  return {
    baseDataOffset: flags & 1 ? reader.readU64BE() : options.moofOffset,
    defaultSampleDescriptionIndex: flags & 2 ? reader.readU32BE() : options.defaults.defaultSampleDescriptionIndex,
    defaultSampleDuration: flags & 8 ? reader.readU32BE() : options.defaults.defaultSampleDuration,
    defaultSampleSize: flags & 16 ? reader.readU32BE() : options.defaults.defaultSampleSize,
    defaultSampleFlags: flags & 32 ? reader.readU32BE() : options.defaults.defaultSampleFlags
  };
}
export function mp4FragmentTime(bytes: Uint8Array, fallback: number): number {
  if (bytes.length < 8) return fallback;
  const reader = new BinaryReader(bytes), version = reader.readU8(); reader.skip(3);
  return version === 1 ? reader.readU64BE() : reader.readU32BE();
}

/** Traverse a single run without retaining its rows or payload. */
export function* mp4FragmentRunSteps(size: number, table: Mp4TableRange, header: FragmentHeader, state: Mp4FragmentState, options: Mp4SampleScanOptions): Mp4SampleSteps<Mp4FragmentState> {
  if (table.payloadSize < 8) return state;
  function* read(offset: number, length: number): Mp4SampleSteps<BinaryReader> {
    if (offset >= table.payloadSize || !length) return new BinaryReader(new Uint8Array());
    return new BinaryReader((yield { kind: 'read', table, offset: table.payloadOffset + offset, length: Math.min(length, table.payloadSize - offset) }) as Uint8Array);
  }
  const reader = yield* read(0, 16), version = reader.readU8(), flags = reader.readU24BE(), count = reader.readU32BE();
  options.budget?.checkSamples(state.sampleCount + count);
  let cursor = header.baseDataOffset + (flags & 1 ? reader.readI32BE() : 0);
  const firstFlags = flags & 4 ? reader.readU32BE() : undefined, start = reader.offset;
  const width = [0x100, 0x200, 0x400, 0x800].reduce((n, bit) => n + (flags & bit ? 4 : 0), 0);
  let dts = state.dts;
  for (let i = 0; i < count; i++) {
    options.budget?.checkCpu();
    const row = yield* read(start + i * width, width);
    const duration = flags & 0x100 ? row.readU32BE() : header.defaultSampleDuration;
    const declaredSize = flags & 0x200 ? row.readU32BE() : header.defaultSampleSize;
    const sampleFlags = flags & 0x400 ? row.readU32BE() : i === 0 && firstFlags !== undefined ? firstFlags : header.defaultSampleFlags;
    const cts = flags & 0x800 ? version === 1 ? row.readI32BE() : row.readU32BE() : 0;
    const offset = Math.max(0, Math.min(size, cursor));
    const isKeyframe = ((sampleFlags >>> 24) & 3) === 2 || (!(sampleFlags & 0x10000) && (i === 0 || options.type !== 'video'));
    yield { kind: 'sample', sample: { offset, size: Math.max(0, Math.min(size - offset, declaredSize)), dts, pts: dts + cts, cts, duration, isKeyframe, sampleDescriptionIndex: header.defaultSampleDescriptionIndex } };
    dts += duration; cursor += declaredSize;
  }
  return { dts, sampleCount: state.sampleCount + count };
}

/**
 * Replay one traf's children. Two sibling scans keep headers independent of box order
 * without collecting runs. Returns carried state even when tfdt has no samples.
 * Source ownership, trex lookup, track iteration and staged publication belong to the caller.
 */
export async function* scanMp4Fragment(source: MediaProbeSource, range: Pick<Mp4BoxScanOptions, 'offset' | 'length' | 'depth'>, options: Mp4FragmentScanOptions): AsyncGenerator<Mp4SampleSpan, Mp4FragmentState> {
  let state = options.state ?? { dts: 0, sampleCount: 0 };
  let tfhd: Mp4TableRange | undefined, tfdt: Mp4TableRange | undefined;
  for await (const box of scanMp4Boxes(source, { ...range, ...options })) {
    if (box.type === 'tfhd' && !tfhd) tfhd = box;
    if (box.type === 'tfdt' && !tfdt) tfdt = box;
  }
  if (!tfhd) return state;
  const header = mp4FragmentHeader(await readMp4SampleRange(source, tfhd.payloadOffset, Math.min(32, tfhd.payloadSize), options), options);
  if (!header) return state;
  if (tfdt) state = { ...state, dts: mp4FragmentTime(await readMp4SampleRange(source, tfdt.payloadOffset, Math.min(12, tfdt.payloadSize), options), state.dts) };
  for await (const box of scanMp4Boxes(source, { ...range, ...options })) {
    if (box.type === 'trun') state = yield* consumeMp4SampleSteps(source, mp4FragmentRunSteps(source.size, box, header, state, options), options);
  }
  return state;
}
