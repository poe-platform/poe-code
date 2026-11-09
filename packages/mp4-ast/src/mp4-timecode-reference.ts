import { decodeMp4Timecode } from "./mp4-timecode-sample.js";
import { scanMp4CodecDescriptions } from "./mp4-codec-source.js";
import { BinaryReader } from './binary.js';
import { scanMp4Boxes, type Mp4BoxSpan, type Mp4BoxScanOptions } from './mp4-source.js';
import { readMp4SampleRange, scanMp4SampleTable, type Mp4SampleTables } from './mp4-sample-source.js';
import { scanMp4Fragment, type Mp4FragmentDefaults } from './mp4-fragment-source.js';
import type { MediaProbeSource } from './types.js';

/** Resolve an exact track ID, reading only its description and first timecode packet. */
export async function probeMp4TimecodeSource(source: MediaProbeSource, moov: Mp4BoxSpan, trackId: number,
  options: Pick<Mp4BoxScanOptions, 'budget' | 'signal' | 'checkpoint'>): Promise<string | undefined> {
  async function first(parent: Mp4BoxSpan | undefined, type: string): Promise<Mp4BoxSpan | undefined> {
    if (parent?.children) for await (const box of scanMp4Boxes(source, { ...parent.children, ...options })) if (box.type === type) return box;
  }
  for await (const trak of scanMp4Boxes(source, { ...moov.children, ...options })) {
    if (trak.type !== 'trak') continue;
    const tkhd = await first(trak, 'tkhd');
    if (!tkhd || tkhd.payloadSize < 24) continue;
    const header = new BinaryReader(await readMp4SampleRange(source, tkhd.payloadOffset, Math.min(36, tkhd.payloadSize), options));
    const version = header.readU8(); header.skip(version === 1 ? 19 : 11);
    if (header.readU32BE() !== trackId) continue;
    const stbl = await first(await first(await first(trak, 'mdia'), 'minf'), 'stbl');
    const stsd = await first(stbl, 'stsd');
    if (!stsd) return;
    let configuration: Uint8Array | undefined;
    for await (const description of scanMp4CodecDescriptions(source, stsd, options)) {
      if (description.formatFourCC !== 'tmcd') return;
      configuration = description.extraData;
      break;
    }
    if (!configuration) return;
    const tables: Mp4SampleTables = {};
    if (stbl?.children) for await (const box of scanMp4Boxes(source, { ...stbl.children, ...options })) {
      if (['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64'].includes(box.type)) tables[box.type as keyof Mp4SampleTables] ??= box;
    }
    for await (const sample of scanMp4SampleTable(source, tables, options)) {
      return sample.size < 4 ? undefined : decodeMp4Timecode(configuration, await readMp4SampleRange(source, sample.offset, 4, options));
    }
    const mvex = await first(moov, 'mvex');
    let defaults: Mp4FragmentDefaults = { defaultSampleDescriptionIndex: 1, defaultSampleDuration: 1024, defaultSampleSize: 0, defaultSampleFlags: 0 };
    if (mvex?.children) for await (const box of scanMp4Boxes(source, { ...mvex.children, ...options })) {
      if (box.type !== 'trex' || box.payloadSize < 24) continue;
      const row = new BinaryReader(await readMp4SampleRange(source, box.payloadOffset + 4, 20, options));
      if (row.readU32BE() === trackId) defaults = { defaultSampleDescriptionIndex: row.readU32BE(), defaultSampleDuration: row.readU32BE(), defaultSampleSize: row.readU32BE(), defaultSampleFlags: row.readU32BE() };
    }
    for await (const moof of scanMp4Boxes(source, options)) {
      if (moof.type !== 'moof' || !moof.children) continue;
      for await (const traf of scanMp4Boxes(source, { ...moof.children, ...options })) {
        if (traf.type !== 'traf' || !traf.children) continue;
        for await (const sample of scanMp4Fragment(source, traf.children, { ...options, trackId, moofOffset: moof.offset, defaults })) {
          return sample.size < 4 ? undefined : decodeMp4Timecode(configuration, await readMp4SampleRange(source, sample.offset, 4, options));
        }
      }
    }
    return;
  }
}
