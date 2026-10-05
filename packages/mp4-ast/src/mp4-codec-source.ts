import { BinaryReader } from './binary.js';
import { parseAv1C, parseHvcC, parseVpcC, parseDOps } from './codecs.js';
import { probeEsdsSource } from './esds-source.js';
import { applyCodecMetadata, finishCodecMetadata, sampleEntryHeader, type Mp4CodecMetadata } from './mp4-codec-metadata.js';
import { readMp4SampleRange, type Mp4TableRange, type Mp4SampleScanOptions } from './mp4-sample-source.js';
import { scanMp4Boxes } from './mp4-source.js';
import type { MediaProbeSource } from './types.js';

/** Enumerate scalar stsd descriptions without retaining entries or opaque codec payloads.
 * Reads are <=16 KiB; only the first length-bounded H.264 SPS is retained while interpreted.
 * The caller owns input admission, source lifetime and publication after complete validation.
 */
export async function* scanMp4CodecDescriptions(source: MediaProbeSource, range: Mp4TableRange, options: Pick<Mp4SampleScanOptions, 'signal' | 'budget' | 'checkpoint'> = {}): AsyncGenerator<Mp4CodecMetadata, void> {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0 || !Number.isSafeInteger(range.payloadOffset) || !Number.isSafeInteger(range.payloadSize) || range.payloadOffset < 0 || range.payloadSize < 0 || range.payloadOffset > source.size || range.payloadSize > source.size - range.payloadOffset)
    throw new RangeError('Invalid MP4 sample description range');
  const read = async (offset: number, length: number) => readMp4SampleRange(source, offset, length, options);
  if (range.payloadSize < 8) return;
  const header = new BinaryReader(await read(range.payloadOffset, 8)); header.skip(4); const count = header.readU32BE();
  const end = range.payloadOffset + range.payloadSize;
  for (let i = 0, offset = range.payloadOffset + 8; i < count && end - offset >= 8; i++) {
    options.signal?.throwIfAborted(); options.budget?.checkCpu();
    const entry = new BinaryReader(await read(offset, 8)), size = entry.readU32BE(), format = entry.readFourCC();
    if (size < 8 || size > end - offset) break;
    const bodyOffset = offset + 8, bodySize = size - 8;
    const state = sampleEntryHeader(format, await read(bodyOffset, Math.min(78, bodySize)));
    if (state.childOffset !== undefined && state.childOffset < bodySize) {
      for await (const child of scanMp4Boxes(source, { offset: bodyOffset + state.childOffset, length: bodySize - state.childOffset, ...options })) {
        const prefix = async (length: number) => read(child.payloadOffset, Math.min(length, child.payloadSize));
        if (state.kind === 'video') {
          if (child.type === 'avcC') {
            const config = await prefix(8), length = config.length >= 8 ? new DataView(config.buffer, config.byteOffset, config.length).getUint16(6) : 0;
            const spsLength = Math.min(length, Math.max(0, child.payloadSize - 8));
            if ((config[5] ?? 0) & 31) {
              try {
                options.budget?.allocateMemory(spsLength);
                const sps = new Uint8Array(spsLength);
                for (let used = 0; used < spsLength; used += 16384) sps.set(await read(child.payloadOffset + 8 + used, Math.min(16384, spsLength - used)), used);
                applyCodecMetadata(state, { type: 'avcC', levelIdc: config[3] ?? 0, sps });
              } finally { options.budget?.releaseMemory(spsLength); }
            } else applyCodecMetadata(state, { type: 'avcC', levelIdc: config[3] ?? 0 });
          } else if (child.type === 'hvcC') applyCodecMetadata(state, { ...parseHvcC(await prefix(23)), type: 'hvcC' });
          else if (child.type === 'av1C') applyCodecMetadata(state, { ...parseAv1C(await prefix(4)), type: 'av1C' });
          else if (child.type === 'vpcC') applyCodecMetadata(state, { ...parseVpcC(await prefix(12)), type: 'vpcC' });
          else if (child.type === 'pasp' && child.payloadSize >= 8) {
            const aspect = new BinaryReader(await prefix(8)); applyCodecMetadata(state, { type: 'pasp', sarWidth: aspect.readU32BE(), sarHeight: aspect.readU32BE() });
          }
        } else if (state.kind === 'audio') {
          if (child.type === 'esds') applyCodecMetadata(state, { type: 'esds', config: await probeEsdsSource(source, child, options) });
          else if (child.type === 'dOps') applyCodecMetadata(state, { ...parseDOps(await prefix(11)), type: 'dOps' });
        }
      }
    }
    yield finishCodecMetadata(state); offset += size;
  }
}
