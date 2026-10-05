import { buildProbeStream, type ProbeSampleStats } from './probe-stream.js';
import { mp4SourceText, probeMp4MetadataSource } from './mp4-metadata-source.js';
import { scanMp4CodecDescriptions } from './mp4-codec-source.js';
import { probeSampleFormat, type Mp4CodecMetadata } from './mp4-codec-metadata.js';
import { BinaryReader, rotationFromMatrix, unpackIsoLanguage } from './binary.js';
import { scanMp4Boxes, type Mp4BoxSpan } from './mp4-source.js';
import { scanMp4Fragment, type Mp4FragmentDefaults } from './mp4-fragment-source.js';
import { consumeMp4SampleSteps, readMp4SampleRange, scanMp4SampleTable, type Mp4SampleScanOptions, type Mp4SampleSpan, type Mp4SampleSteps, type Mp4SampleTables } from './mp4-sample-source.js';
import { MediaBudgetTracker, type MediaProbePacket, type MediaProbeFrame, type MediaProbeSource, type MediaResourceLimits, type MediaTrackType, type MediaProbeSourceStream, type MediaProbeSourceRecords, type MediaProbeText } from './types.js';

export interface Mp4PacketScanOptions extends Omit<Mp4SampleScanOptions, 'type' | 'syncSamples'> {
  readonly limits?: MediaResourceLimits;
  /** A fresh caller-owned membership index for each track; its lifetime belongs to the caller. */
  readonly syncSamples?: (trackIndex: number) => Mp4SampleScanOptions['syncSamples'] | Promise<Mp4SampleScanOptions['syncSamples']>;
}

type ProbeSample = {
  sample: Pick<Mp4SampleSpan, 'pts' | 'dts' | 'duration' | 'size' | 'isKeyframe'>;
  track: { index: number; type: MediaTrackType; timescale: number; width: number | undefined; height: number | undefined; codec: Mp4CodecMetadata | undefined };
  bytePos: number;
};

/** Replay packet descriptors without retaining tracks, boxes, table rows or payloads. */
export async function* scanMp4Packets(source: MediaProbeSource, options: Mp4PacketScanOptions = {}): AsyncGenerator<MediaProbePacket, void> {
  for await (const record of scanProbeRecords(source, options, 'packets')) {
    if (!('sample' in record)) continue;
    const { sample, track, bytePos } = record;
    const scale = Math.max(1, track.timescale);
    yield { codec_type: track.type, stream_index: track.index, pts: sample.pts, pts_time: (sample.pts / scale).toFixed(6), dts: sample.dts, dts_time: (sample.dts / scale).toFixed(6), duration: sample.duration, duration_time: (sample.duration / scale).toFixed(6), size: String(sample.size), pos: String(bytePos), flags: sample.isKeyframe ? 'K_' : '__' };
  }
}

/** Replay frame descriptors with bounded scalar codec metadata; no media decoding. */
export async function* scanMp4Frames(source: MediaProbeSource, options: Mp4PacketScanOptions = {}): AsyncGenerator<MediaProbeFrame, void> {
  for await (const record of scanProbeRecords(source, options, 'frames')) {
    if (!('sample' in record)) continue;
    const { sample, track } = record;
    const scale = Math.max(1, track.timescale), ptsTime = (sample.pts / scale).toFixed(6);
    yield { media_type: track.type, stream_index: track.index, key_frame: sample.isKeyframe ? 1 : 0,
      pts: sample.pts, pts_time: ptsTime, pkt_dts: sample.dts, pkt_dts_time: (sample.dts / scale).toFixed(6),
      best_effort_timestamp: sample.pts, best_effort_timestamp_time: ptsTime,
      pkt_duration: sample.duration, pkt_duration_time: (sample.duration / scale).toFixed(6), pkt_size: String(sample.size),
      width: track.width, height: track.height, pix_fmt: track.type === 'video' ? (track.codec?.pixFmt ?? 'yuv420p') : undefined,
      pict_type: track.type === 'video' ? (sample.isKeyframe ? 'I' : 'P') : undefined,
      sample_fmt: probeSampleFormat(track.type, track.codec?.codecName ?? (track.type === 'video' ? 'h264' : 'aac')),
      nb_samples: track.type === 'audio' ? sample.duration : undefined, channels: track.type === 'audio' ? (track.codec?.channels ?? 2) : undefined };
  }
}

async function* scanProbeRecords(source: MediaProbeSource, options: Mp4PacketScanOptions, mode: 'packets' | 'frames' | 'streams' | 'summary'): AsyncGenerator<ProbeSample | MediaProbeSourceStream, { duration: number; tracks: number }> {
  options.signal?.throwIfAborted();
  const withCodec = mode === 'frames' || mode === 'streams';
  const budget = options.budget ?? new MediaBudgetTracker(options.limits), work = { budget, ...(options.signal ? { signal: options.signal } : {}), ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}) };
  budget.checkInputBytes(source.size);
  const read = async (box: Mp4BoxSpan | undefined, length: number) => new BinaryReader(box ? await readMp4SampleRange(source, box.payloadOffset, Math.min(length, box.payloadSize), work) : new Uint8Array());
  async function first(parent: Mp4BoxSpan | undefined, type: string): Promise<Mp4BoxSpan | undefined> {
    if (!parent?.children) return;
    for await (const box of scanMp4Boxes(source, { ...parent.children, ...work })) if (box.type === type) return box;
  }
  let moov: Mp4BoxSpan | undefined, fragmented = false;
  for await (const box of scanMp4Boxes(source, work)) { if (box.type === 'moov' && !moov) moov = box; if (box.type === 'moof') fragmented = true; }
  if (!moov) throw new Error("Invalid MP4/ISOBMFF file: missing 'moov' atom");
  const mvhd = await first(moov, 'mvhd'), movie = await read(mvhd, 32);
  let movieTimescale = 1000, movieDuration = 0;
  if ((mvhd?.payloadSize ?? 0) >= 20) {
    const version = movie.readU8(); movie.skip(3 + (version === 1 ? 16 : 8));
    movieTimescale = movie.readU32BE() || 1000; movieDuration = version === 1 ? movie.readU64BE() : movie.readU32BE();
  }
  const mvex = await first(moov, 'mvex');
  let trackIndex = 0, maxDuration = movieDuration / Math.max(1, movieTimescale);
  for await (const trak of scanMp4Boxes(source, { ...moov.children, ...work })) {
    if (trak.type !== 'trak') continue;
    const index = trackIndex++; budget.checkStreams(trackIndex);
    const tkhd = await first(trak, 'tkhd'), header = await read(tkhd, withCodec ? 96 : 36);
    let id = index + 1, headerDuration = 0, width: number | undefined, height: number | undefined, enabled = true, rotation = 0;
    if ((tkhd?.payloadSize ?? 0) >= 24) {
      const version = header.readU8(); enabled = (header.readU24BE() & 1) !== 0; header.skip(version === 1 ? 16 : 8);
      id = header.readU32BE() || id; header.skip(4); headerDuration = version === 1 ? header.readU64BE() : header.readU32BE();
      if (withCodec) { header.skip(16); const matrix = Array.from({ length: 9 }, () => header.readI32BE()); rotation = rotationFromMatrix(matrix); const w = Math.round(header.readFixed16_16()), h = Math.round(header.readFixed16_16()); if (w > 0) width = w; if (h > 0) height = h; }
    }
    const mdia = await first(trak, 'mdia'), mdhd = await first(mdia, 'mdhd'), media = await read(mdhd, 34);
    let timescale = movieTimescale, declaredDuration = 0, language = 'und';
    if ((mdhd?.payloadSize ?? 0) >= 20) {
      const version = media.readU8(); media.skip(3 + (version === 1 ? 16 : 8));
      timescale = media.readU32BE() || 1000; declaredDuration = version === 1 ? media.readU64BE() : media.readU32BE(); language = unpackIsoLanguage(media.readU16BE());
    }
    const hdlr = await first(mdia, 'hdlr'), handler = await read(hdlr, 12); handler.skip(8);
    const handlerType = (hdlr?.payloadSize ?? 0) >= 12 ? handler.readFourCC() : 'vide';
    const type: MediaTrackType = handlerType === 'vide' ? 'video' : handlerType === 'soun' ? 'audio' : ['sbtl', 'text', 'subp'].includes(handlerType) ? 'subtitle' : 'data';
    const stbl = await first(await first(mdia, 'minf'), 'stbl'), tables: Mp4SampleTables = {};
    if (stbl?.children) for await (const box of scanMp4Boxes(source, { ...stbl.children, ...work })) {
      if (['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss'].includes(box.type)) { const name = box.type as keyof Mp4SampleTables; tables[name] ??= box; }
    }
    let codec: Mp4CodecMetadata | undefined;
    if (withCodec) {
      const stsd = await first(stbl, 'stsd');
      if (stsd) for await (const description of scanMp4CodecDescriptions(source, stsd, work)) { codec = description; break; }
    }
    let handlerName: MediaProbeText | undefined;
    if (mode === 'streams' && hdlr && hdlr.payloadSize > 24) {
      const offset = hdlr.payloadOffset + 24; let length = hdlr.payloadSize - 24;
      for (let used = 0; used < length;) {
        const bytes = await readMp4SampleRange(source, offset + used, Math.min(16384, length - used), work), nul = bytes.indexOf(0);
        budget.checkCpu();
        if (nul >= 0) { length = used + nul; break; } used += bytes.length;
      }
      const text = mp4SourceText(source, offset, length, work);
      for await (const chunk of text.chunks()) if (chunk) { handlerName = text; break; }
    }
    const track = { index, id, type, timescale, width: width ?? codec?.width, height: height ?? codec?.height, codec, enabled, rotation, language, handlerName };
    let defaults: Mp4FragmentDefaults = { defaultSampleDescriptionIndex: 1, defaultSampleDuration: type === 'video' ? 3000 : 1024, defaultSampleSize: 0, defaultSampleFlags: 0 };
    if (mvex?.children) for await (const box of scanMp4Boxes(source, { ...mvex.children, ...work })) {
      if (box.type !== 'trex' || box.payloadSize < 24) continue;
      const row = await read(box, 24); row.skip(4); if (row.readU32BE() !== id) continue;
      defaults = { defaultSampleDescriptionIndex: row.readU32BE() || 1, defaultSampleDuration: row.readU32BE() || 1024, defaultSampleSize: row.readU32BE(), defaultSampleFlags: row.readU32BE() };
    }
    const syncSamples = await options.syncSamples?.(index), sampleOptions = { ...work, type, ...(syncSamples ? { syncSamples } : {}) };
    async function* samples(): AsyncGenerator<Mp4SampleSpan, void> {
      let state = { dts: 0, sampleCount: 0 };
      for await (const sample of scanMp4SampleTable(source, tables, sampleOptions)) {
        state = { dts: sample.dts + sample.duration, sampleCount: state.sampleCount + 1 }; yield sample;
      }
      if (fragmented) for await (const moof of scanMp4Boxes(source, work)) {
        if (moof.type !== 'moof' || !moof.children) continue;
        for await (const traf of scanMp4Boxes(source, { ...moof.children, ...work })) {
          if (traf.type === 'traf' && traf.children) state = yield* scanMp4Fragment(source, traf.children, { ...work, type, trackId: id, moofOffset: moof.offset, defaults, state });
        }
      }
    }
    let duration = 0, mediaEnd = 0, allPacked = true, count = 0;
    for await (const sample of samples()) {
      count++; duration += sample.duration; mediaEnd = Math.max(mediaEnd, sample.pts + sample.duration);
      if (type === 'subtitle' && allPacked) {
        if (sample.size < 2) allPacked = false;
        else allPacked = new BinaryReader(await readMp4SampleRange(source, sample.offset, 2, work)).readU16BE() === sample.size - 2;
      }
    }
    const elst = await first(await first(trak, 'edts'), 'elst');
    function* editDuration(): Mp4SampleSteps<number | undefined> {
      if (!elst || elst.payloadSize < 8) return;
      const header = new BinaryReader((yield { kind: 'read', table: elst, offset: elst.payloadOffset, length: 8 }) as Uint8Array);
      const version = header.readU8(); header.skip(3); const count = header.readU32BE(), width = version === 1 ? 20 : 12;
      let total = 0, entries = 0;
      for (let i = 0; i < count && 8 + i * width < elst.payloadSize; i++) {
        const row = new BinaryReader((yield { kind: 'read', table: elst, offset: elst.payloadOffset + 8 + i * width, length: Math.min(width, elst.payloadSize - 8 - i * width) }) as Uint8Array);
        let segment = version === 1 ? row.readU64BE() : row.readU32BE();
        const mediaTime = version === 1 ? row.readI64BE() : row.readI32BE();
        if (fragmented && segment === 0 && mediaTime >= 0) segment = Math.round(Math.max(0, mediaEnd - mediaTime) * movieTimescale / timescale);
        total += segment; entries++;
      }
      return entries ? Math.round(total * timescale / movieTimescale) : undefined;
    }
    const edits = consumeMp4SampleSteps(source, editDuration(), sampleOptions), result = await edits.next();
    // The edit coroutine only reads rows and returns a scalar; it never emits samples.
    if (!result.done) throw new Error('Unexpected MP4 edit sample');
    const trackDuration = result.value ?? (duration || declaredDuration || Math.round(headerDuration / Math.max(1, movieTimescale) * timescale));
    maxDuration = Math.max(maxDuration, trackDuration / Math.max(1, timescale)); budget.checkDuration(maxDuration);
    if (mode === 'summary') continue;
    let bytePos = 0, cursor = 0;
    const stats: ProbeSampleStats = { totalBytes: 0, count: 0, ticks: 0, firstPts: 0, hasCts: false };
    const packet = (sample: ProbeSample['sample']): ProbeSample => {
      if (mode === 'streams') {
        if (!stats.count) stats.firstPts = sample.pts;
        stats.count++; stats.totalBytes += sample.size; stats.ticks += sample.duration; stats.hasCts ||= sample.pts !== sample.dts;
      }
      const record = { sample, track, bytePos }; bytePos += sample.size; return record;
    };
    for await (const sample of samples()) {
      if (type !== 'subtitle' || !count || allPacked) { const row = packet(sample); if (mode !== 'streams') yield row; continue; }
      const start = Math.max(cursor, Math.round(sample.pts));
      if (start > cursor) { const row = packet({ pts: cursor, dts: cursor, duration: start - cursor, size: 2, isKeyframe: true }); if (mode !== 'streams') yield row; cursor = start; }
      const duration = Math.max(1, Math.round(sample.duration));
      const row = packet({ pts: cursor, dts: cursor, duration, size: sample.size + 2, isKeyframe: true }); if (mode !== 'streams') yield row; cursor += duration;
    }
    if (mode === 'streams') yield buildProbeStream({ ...track, duration: trackDuration }, codec, stats, index, 'mp4');
  }
  budget.checkDuration(maxDuration);
  return { duration: maxDuration, tracks: trackIndex };
}

export interface Mp4SourceProbeOptions extends Mp4PacketScanOptions {
  readonly filename?: string;
  readonly showPackets?: boolean;
  readonly showFrames?: boolean;
}

/** Bounded native metadata and replayable record sources. The caller owns input and indexes. */
export async function probeMp4Source(source: MediaProbeSource, options: Mp4SourceProbeOptions = {}): Promise<MediaProbeSourceRecords> {
  const work = { ...options, budget: options.budget ?? new MediaBudgetTracker(options.limits) };
  const scan = scanProbeRecords(source, work, 'summary'), summary = await scan.next();
  if (!summary.done) throw new Error('Unexpected MP4 summary row');
  const { duration, tracks } = summary.value, metadata = await probeMp4MetadataSource(source, duration, work);
  async function* streams(): AsyncGenerator<MediaProbeSourceStream> {
    for await (const row of scanProbeRecords(source, work, 'streams')) if (!('sample' in row)) yield row;
  }
  return { streams: { [Symbol.asyncIterator]: streams },
    format: { filename: options.filename ?? 'input.mp4', nb_streams: tracks, nb_programs: 0,
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2', format_long_name: 'QuickTime / MOV', start_time: '0.000000',
      duration: duration.toFixed(6), size: String(source.size), bit_rate: duration > 0 ? String(Math.round(source.size * 8 / duration)) : '0', probe_score: 100, tags: metadata.tags },
    chapters: metadata.chapters,
    packets: options.showPackets ? scanMp4Packets(source, work) : undefined,
    frames: options.showFrames ? scanMp4Frames(source, work) : undefined };
}
