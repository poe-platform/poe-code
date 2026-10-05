import { BinaryReader, decodeLatin1, decodeUtf8 } from './binary.js';
import { scanMp4Boxes, type Mp4BoxSpan, type Mp4BoxScanOptions } from './mp4-source.js';
import { readMp4SampleRange } from './mp4-sample-source.js';
import { mp4TextMetadataKeys, mp4ProbeMetadataKeys } from './mp4-metadata.js';
import { MediaBudgetTracker, type MediaProbeSource, type MediaProbeSourceTags, type MediaProbeText, type MediaProbeSourceChapter } from './types.js';

type MetadataOptions = Pick<Mp4BoxScanOptions, 'budget' | 'signal' | 'checkpoint'>;

/** Probe-only tags and chapters. Caller retains the source until all field/row reads finish. */
export async function probeMp4MetadataSource(source: MediaProbeSource, durationSeconds: number, options: MetadataOptions = {}): Promise<{
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
  function text(offset: number, length: number, latin1 = false): MediaProbeText {
    return { kind: 'text', async *chunks() {
      work.signal?.throwIfAborted(); work.budget.allocateMemory(Math.min(length, 16384));
      try {
        const decoder = new TextDecoder();
        for (let used = 0; used < length;) {
          const bytes = await read(offset + used, Math.min(16384, length - used)); used += bytes.length;
          const chunk = latin1 ? decodeLatin1(bytes) : decoder.decode(bytes, { stream: true });
          if (chunk) yield chunk;
        }
        if (!latin1) { const tail = decoder.decode(); if (tail) yield tail; }
      } finally { work.budget.releaseMemory(Math.min(length, 16384)); }
    } };
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
    if (length) tags.compatible_brands = text(brands.payloadOffset + 8, length, true);
  }
  const udta = await first(moov, 'udta'), meta = await first(udta, 'meta') ?? await first(moov, 'meta'), ilst = await first(meta, 'ilst');
  const values: Partial<Record<(typeof mp4ProbeMetadataKeys)[number], MediaProbeText>> = {};
  if (ilst?.children) for await (const item of scanMp4Boxes(source, { ...ilst.children, ...work })) {
    const key = mp4TextMetadataKeys[item.type];
    if (!key || !mp4ProbeMetadataKeys.some(name => name === key)) continue;
    let data: Mp4BoxSpan | undefined;
    for await (const box of scanMp4Boxes(source, { offset: item.payloadOffset, length: item.payloadSize, ...work })) if (box.type === 'data') { data = box; break; }
    if (!data && item.payloadSize < 8) continue;
    const value = data ?? item, skip = data && data.payloadSize >= 8 ? 8 : 0;
    const offset = value.payloadOffset + skip; let length = value.payloadSize - skip;
    // UTF-8 NUL is a single zero byte, so suffix trimming needs no resident decoded value.
    while (length) {
      const size = Math.min(16384, length), suffix = await read(offset + length - size, size);
      let end = suffix.length; while (end && suffix[end - 1] === 0) end--;
      length -= size - end; if (end) break;
    }
    if (!length) continue;
    // The resident UTF-8 decoder removes a leading BOM; BOM-only values are empty.
    if (length === 3) { const prefix = await read(offset, 3); if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) continue; }
    values[key as (typeof mp4ProbeMetadataKeys)[number]] = text(offset, length);
  }
  // Probe tag order is schema order, independent of the container's item order.
  for (const key of mp4ProbeMetadataKeys) if (values[key]) tags[key] = values[key]!;
  const chpl = await first(udta, 'chpl');
  async function* chapters(): AsyncGenerator<MediaProbeSourceChapter> {
    work.signal?.throwIfAborted();
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
  return { tags, chapters: { [Symbol.asyncIterator]: chapters } };
}
