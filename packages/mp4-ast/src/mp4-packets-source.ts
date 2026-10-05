import { BinaryReader } from './binary.js';
import { scanMp4Boxes, type Mp4BoxSpan } from './mp4-source.js';
import { scanMp4Fragment, type Mp4FragmentDefaults } from './mp4-fragment-source.js';
import { consumeMp4SampleSteps, readMp4SampleRange, scanMp4SampleTable, type Mp4SampleScanOptions, type Mp4SampleSpan, type Mp4SampleSteps, type Mp4SampleTables } from './mp4-sample-source.js';
import { MediaBudgetTracker, type MediaProbePacket, type MediaProbeSource, type MediaResourceLimits, type MediaTrackType } from './types.js';

export interface Mp4PacketScanOptions extends Omit<Mp4SampleScanOptions, 'type' | 'syncSamples'> {
  readonly limits?: MediaResourceLimits;
  /** A fresh caller-owned membership index for each track; its lifetime belongs to the caller. */
  readonly syncSamples?: (trackIndex: number) => Mp4SampleScanOptions['syncSamples'] | Promise<Mp4SampleScanOptions['syncSamples']>;
}

/** Replay packet descriptors without retaining tracks, boxes, table rows or payloads. */
export async function* scanMp4Packets(source: MediaProbeSource, options: Mp4PacketScanOptions = {}): AsyncGenerator<MediaProbePacket, void> {
  options.signal?.throwIfAborted();
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
    const tkhd = await first(trak, 'tkhd'), header = await read(tkhd, 36);
    let id = index + 1, headerDuration = 0;
    if ((tkhd?.payloadSize ?? 0) >= 24) {
      const version = header.readU8(); header.skip(3 + (version === 1 ? 16 : 8));
      id = header.readU32BE() || id; header.skip(4); headerDuration = version === 1 ? header.readU64BE() : header.readU32BE();
    }
    const mdia = await first(trak, 'mdia'), mdhd = await first(mdia, 'mdhd'), media = await read(mdhd, 32);
    let timescale = movieTimescale, declaredDuration = 0;
    if ((mdhd?.payloadSize ?? 0) >= 20) {
      const version = media.readU8(); media.skip(3 + (version === 1 ? 16 : 8));
      timescale = media.readU32BE() || 1000; declaredDuration = version === 1 ? media.readU64BE() : media.readU32BE();
    }
    const hdlr = await first(mdia, 'hdlr'), handler = await read(hdlr, 12); handler.skip(8);
    const handlerType = (hdlr?.payloadSize ?? 0) >= 12 ? handler.readFourCC() : 'vide';
    const type: MediaTrackType = handlerType === 'vide' ? 'video' : handlerType === 'soun' ? 'audio' : ['sbtl', 'text', 'subp'].includes(handlerType) ? 'subtitle' : 'data';
    const stbl = await first(await first(mdia, 'minf'), 'stbl'), tables: Mp4SampleTables = {};
    if (stbl?.children) for await (const box of scanMp4Boxes(source, { ...stbl.children, ...work })) {
      if (['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss'].includes(box.type)) { const name = box.type as keyof Mp4SampleTables; tables[name] ??= box; }
    }
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
    let bytePos = 0, cursor = 0;
    const packet = (sample: Pick<Mp4SampleSpan, 'pts' | 'dts' | 'duration' | 'size' | 'isKeyframe'>): MediaProbePacket => {
      const result = { codec_type: type, stream_index: index, pts: sample.pts, pts_time: (sample.pts / Math.max(1, timescale)).toFixed(6), dts: sample.dts, dts_time: (sample.dts / Math.max(1, timescale)).toFixed(6), duration: sample.duration, duration_time: (sample.duration / Math.max(1, timescale)).toFixed(6), size: String(sample.size), pos: String(bytePos), flags: sample.isKeyframe ? 'K_' : '__' };
      bytePos += sample.size; return result;
    };
    for await (const sample of samples()) {
      if (type !== 'subtitle' || !count || allPacked) { yield packet(sample); continue; }
      const start = Math.max(cursor, Math.round(sample.pts));
      if (start > cursor) { yield packet({ pts: cursor, dts: cursor, duration: start - cursor, size: 2, isKeyframe: true }); cursor = start; }
      const duration = Math.max(1, Math.round(sample.duration));
      yield packet({ pts: cursor, dts: cursor, duration, size: sample.size + 2, isKeyframe: true }); cursor += duration;
    }
  }
  budget.checkDuration(maxDuration);
}
