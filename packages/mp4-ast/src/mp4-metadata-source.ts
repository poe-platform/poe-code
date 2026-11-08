import { readImageMetadataFromSource } from "@poe-code/image-ast/portable";
import { BinaryReader, decodeLatin1, decodeUtf8 } from './binary.js';
import { scanMp4Boxes, type Mp4BoxSpan, type Mp4BoxScanOptions } from './mp4-source.js';
import { scanMp4SampleTable, type Mp4SampleTables, readMp4SampleRange } from './mp4-sample-source.js';
import { scanMp4Fragment, type Mp4FragmentDefaults } from './mp4-fragment-source.js';
import { mp4TextMetadataKeys, mp4ProbeMetadataKeys } from './mp4-metadata.js';
import { MediaBudgetTracker, type MediaProbeSource, type MediaProbeSourceTags, type MediaProbeText, type MediaProbeSourceChapter } from './types.js';

type MetadataOptions = Pick<Mp4BoxScanOptions, 'budget' | 'signal' | 'checkpoint'>;

/** Probe-only tags and chapters. Caller retains the source until all field/row reads finish. */
export async function probeMp4MetadataSource(source: MediaProbeSource, durationSeconds: number, options: MetadataOptions = {}): Promise<{
  coverArt?: { width: number; height: number; codecName: string; size: number };
  tags: MediaProbeSourceTags;
  chapters: AsyncIterable<MediaProbeSourceChapter>;
}> {
  const work = { ...options, budget: options.budget ?? new MediaBudgetTracker() };
  work.signal?.throwIfAborted(); work.budget.checkInputBytes(source.size);
  async function read(offset: number, length: number) {
    work.budget.checkCpu(); return readMp4SampleRange(source, offset, length, work);
  }
  async function first(parent: Mp4BoxSpan | undefined, type: string): Promise<Mp4BoxSpan | undefined> {
    if (parent?.children) for await (const box of scanMp4Boxes(source, { ...parent.children, ...work })) if (box.type === type) return box;
  }
  let moov: Mp4BoxSpan | undefined, ftyp: Mp4BoxSpan | undefined, styp: Mp4BoxSpan | undefined;
  for await (const box of scanMp4Boxes(source, work)) {
    if (box.type === 'moov') moov ??= box;
    else if (box.type === 'ftyp') ftyp ??= box;
    else if (box.type === 'styp') styp ??= box;
  }
  if (!moov) throw new Error("Invalid MP4/ISOBMFF file: missing 'moov' atom");
  const tags: Record<string, string | MediaProbeText> = { major_brand: 'isom', minor_version: '512' }, brands = ftyp ?? styp;
  if (brands && brands.payloadSize >= 8) {
    const prefix = new BinaryReader(await read(brands.payloadOffset, 8));
    tags.major_brand = prefix.readFourCC(); tags.minor_version = String(prefix.readU32BE());
    const length = Math.floor((brands.payloadSize - 8) / 4) * 4;
    if (length) tags.compatible_brands = mp4SourceText(source, brands.payloadOffset + 8, length, work, true);
  }
  const udta = await first(moov, 'udta'), meta = await first(udta, 'meta') ?? await first(moov, 'meta'), ilst = await first(meta, 'ilst');
  const keys = await first(meta, 'keys');
  const names = new Map<number, string>();
  if (keys && keys.payloadSize >= 8) {
    const count = new BinaryReader(await read(keys.payloadOffset + 4, 4)).readU32BE();
    let offset = keys.payloadOffset + 8;
    const end = keys.payloadOffset + keys.payloadSize;
    for (let index = 1; index <= count && end - offset >= 8; index++) {
      const header = new BinaryReader(await read(offset, 8));
      const size = header.readU32BE(), namespace = header.readFourCC();
      if (size < 8 || size > end - offset) break;
      if (namespace === 'mdta') names.set(index, decodeUtf8(await read(offset + 8, size - 8)));
      offset += size;
    }
  }
  const values: Partial<Record<keyof typeof mp4ProbeMetadataKeys, MediaProbeText | string>> = {};
  let coverArt: { width: number; height: number; codecName: string; size: number } | undefined;
  if (ilst?.children) for await (const item of scanMp4Boxes(source, { ...ilst.children, ...work })) {
    const name = names.get([...item.type].reduce((index, char) => index * 256 + char.charCodeAt(0), 0));
    if (keys && name === undefined) continue;
    const key = mp4TextMetadataKeys[item.type];
    if (item.type !== "cpil" && item.type !== "covr" && item.type !== "trkn" && item.type !== "disk" && !key && name === undefined) continue;
    let data: Mp4BoxSpan | undefined;
    for await (const box of scanMp4Boxes(source, { offset: item.payloadOffset, length: item.payloadSize, ...work })) if (box.type === 'data') { data = box; break; }
    if (!data && item.payloadSize < 8) continue;
    const value = data ?? item, skip = data && data.payloadSize >= 8 ? 8 : 0;
    const offset = value.payloadOffset + skip; let length = value.payloadSize - skip;
    if (name !== undefined && (!data || data.payloadSize < 8 || new BinaryReader(await read(data.payloadOffset, 4)).readU32BE() !== 1)) continue;
    if (item.type === "cpil") {
      if (data && data.payloadSize >= 9) values.compilation = String((await read(offset, 1))[0]);
      continue;
    }
    if (item.type === "trkn" || item.type === "disk") {
      if (length >= 6) {
        const number = new BinaryReader(await read(offset + 2, 4));
        const current = number.readU16BE(), total = number.readU16BE();
        values[item.type === "trkn" ? "trackNumber" : "discNumber"] = total > 0 ? `${current}/${total}` : String(current);
      }
      continue;
    }
    if (item.type === "covr") {
      if (!data || data.payloadSize < 8) continue;
      const type = new BinaryReader(await read(data.payloadOffset, 4)).readU32BE();
      if (type !== 13 && type !== 14) continue;
      const image = await readImageMetadataFromSource({ size: length,
        async read(at, count) { return read(offset + at, Math.min(count, length - at)); }
      }, work.signal ?? new AbortController().signal);
      coverArt = { width: image.width, height: image.height, codecName: type === 14 ? "png" : "mjpeg", size: length };
      continue;
    }
    // UTF-8 NUL is a single zero byte, so suffix trimming needs no resident decoded value.
    while (length) {
      const size = Math.min(16384, length), suffix = await read(offset + length - size, size);
      let end = suffix.length; while (end && suffix[end - 1] === 0) end--;
      length -= size - end; if (end) break;
    }
    if (!length) continue;
    // The resident UTF-8 decoder removes a leading BOM; BOM-only values are empty.
    if (length === 3) { const prefix = await read(offset, 3); if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) continue; }
    if (name !== undefined) Object.defineProperty(tags, name, { value: mp4SourceText(source, offset, length, work), enumerable: true, configurable: true });
    else values[key as keyof typeof mp4ProbeMetadataKeys] = mp4SourceText(source, offset, length, work);
  }
  // Probe tag order is schema order, independent of the container's item order.
  for (const key of Object.keys(mp4ProbeMetadataKeys) as (keyof typeof mp4ProbeMetadataKeys)[]) {
    if (values[key]) tags[mp4ProbeMetadataKeys[key]] = values[key]!;
  }
  const chpl = await first(udta, 'chpl');
  const ids = new Set<number>();
  for await (const trak of scanMp4Boxes(source, { ...moov!.children, ...work })) {
    if (trak.type !== 'trak') continue;
    const reference = await first(await first(trak, 'tref'), 'chap');
    if (!reference) continue;
    for (let at = 0; at + 4 <= reference.payloadSize; at += 4) {
      ids.add(new BinaryReader(await read(reference.payloadOffset + at, 4)).readU32BE());
    }
  }
  async function* chapters(): AsyncGenerator<MediaProbeSourceChapter> {
    work.signal?.throwIfAborted();
    if (ids.size) for await (const trak of scanMp4Boxes(source, { ...moov!.children, ...work })) {
      if (trak.type !== 'trak') continue;
      const tkhd = await first(trak, 'tkhd');
      if (!tkhd || tkhd.payloadSize < 24) continue;
      const header = new BinaryReader(await read(tkhd.payloadOffset, Math.min(36, tkhd.payloadSize)));
      const version = header.readU8(); header.skip(version === 1 ? 19 : 11);
      const trackId = header.readU32BE();
      if (!ids.has(trackId)) continue;
      const mdia = await first(trak, 'mdia'), mdhd = await first(mdia, 'mdhd');
      if (!mdhd || mdhd.payloadSize < 24) continue;
      const media = new BinaryReader(await read(mdhd.payloadOffset, Math.min(32, mdhd.payloadSize)));
      const mediaVersion = media.readU8(); media.skip(mediaVersion === 1 ? 19 : 11);
      const timescale = media.readU32BE() || 1000;
      const stbl = await first(await first(mdia, 'minf'), 'stbl');
      const tables: Mp4SampleTables = {};
      for (const name of ['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64'] as const) {
        const box = await first(stbl, name); if (box) tables[name] = box;
      }
      let defaults: Mp4FragmentDefaults = { defaultSampleDescriptionIndex: 1, defaultSampleDuration: 1024, defaultSampleSize: 0, defaultSampleFlags: 0 };
      const mvex = await first(moov, 'mvex');
      if (mvex?.children) for await (const box of scanMp4Boxes(source, { ...mvex.children, ...work })) {
        if (box.type !== 'trex' || box.payloadSize < 24) continue;
        const trex = new BinaryReader(await read(box.payloadOffset + 4, 20));
        if (trex.readU32BE() === trackId) defaults = { defaultSampleDescriptionIndex: trex.readU32BE(), defaultSampleDuration: trex.readU32BE(), defaultSampleSize: trex.readU32BE(), defaultSampleFlags: trex.readU32BE() };
      }
      async function* samples() {
        let state = { dts: 0, sampleCount: 0 };
        for await (const sample of scanMp4SampleTable(source, tables, work)) {
          state = { dts: sample.dts + sample.duration, sampleCount: state.sampleCount + 1 }; yield sample;
        }
        for await (const moof of scanMp4Boxes(source, work)) {
          if (moof.type !== 'moof') continue;
          for await (const traf of scanMp4Boxes(source, { ...moof.children, ...work })) {
            if (traf.type === 'traf') state = yield* scanMp4Fragment(source, traf.children!, { ...work, trackId, moofOffset: moof.offset, defaults, state });
          }
        }
      }
      let id = 0;
      for await (const sample of samples()) {
        if (sample.size < 2) continue;
        const length = new BinaryReader(await read(sample.offset, 2)).readU16BE();
        if (length > sample.size - 2) continue;
        const start = sample.dts / timescale, end = (sample.dts + sample.duration) / timescale;
        yield { id: id++, time_base: '1/1000', start: Math.round(start * 1000), start_time: start.toFixed(6),
          end: Math.round(end * 1000), end_time: end.toFixed(6), tags: { title: decodeUtf8(await read(sample.offset + 2, length)) } };
      }
      if (id) return;
    }
    if (!chpl || chpl.payloadSize < 9) return;
    const end = chpl.payloadOffset + chpl.payloadSize;
    let at = chpl.payloadOffset + 9, count = (await read(chpl.payloadOffset + 8, 1))[0]!;
    if (!count && end - at >= 4) { count = new BinaryReader(await read(at, 4)).readU32BE(); at += 4; }
    let previous: { id: number; start: number; title: string } | undefined;
    const row = (chapter: NonNullable<typeof previous>, finish: number): MediaProbeSourceChapter => ({ id: chapter.id, time_base: '1/1000', start: Math.round(chapter.start * 1000), start_time: chapter.start.toFixed(6), end: Math.round(finish * 1000), end_time: finish.toFixed(6), tags: { title: chapter.title } });
    for (let id = 0; id < count && end - at >= 9; id++) {
      const prefix = new BinaryReader(await read(at, 9)); at += 9;
      const start = prefix.readU64BE() / 10000000, length = Math.min(prefix.readU8(), end - at);
      const title = decodeUtf8(await read(at, length)); at += length;
      if (previous) yield row(previous, start);
      previous = { id, start, title };
    }
    if (previous) yield row(previous, Math.max(previous.start, durationSeconds));
  }
  return { ...(coverArt ? { coverArt } : {}), tags, chapters: { [Symbol.asyncIterator]: chapters } };
}

export function mp4SourceText(source: MediaProbeSource, offset: number, length: number, work: MetadataOptions, latin1 = false): MediaProbeText {
  return { kind: 'text', async *chunks() {
    work.signal?.throwIfAborted(); work.budget?.allocateMemory(Math.min(length, 16384));
    try {
      const decoder = new TextDecoder();
      for (let used = 0; used < length;) {
        work.budget?.checkCpu();
        const bytes = await readMp4SampleRange(source, offset + used, Math.min(16384, length - used), work); used += bytes.length;
        const chunk = latin1 ? decodeLatin1(bytes) : decoder.decode(bytes, { stream: true });
        if (chunk) yield chunk;
      }
      if (!latin1) { const tail = decoder.decode(); if (tail) yield tail; }
    } finally { work.budget?.releaseMemory(Math.min(length, 16384)); }
  } };
}
