import { esdsSteps } from './codecs.js';
import { consumeMp4SampleSteps, type Mp4SampleScanOptions, type Mp4TableRange } from './mp4-sample-source.js';
import type { MediaProbeSource, Mp4AudioSpecificConfig } from './types.js';

export type Mp4AudioSpecificMetadata = Omit<Mp4AudioSpecificConfig, 'decoderSpecificInfo' | 'rawEsdsBytes'>;

/** Read ES descriptor metadata with one 16 KiB page; skip opaque decoder payloads.
 * The caller owns source admission and lifetime. No filesystem or codec payload is retained.
 */
export async function probeEsdsSource(source: MediaProbeSource, range: Mp4TableRange, options: Pick<Mp4SampleScanOptions, 'signal' | 'budget' | 'checkpoint'> = {}): Promise<Mp4AudioSpecificMetadata> {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0 || !Number.isSafeInteger(range.payloadOffset) || !Number.isSafeInteger(range.payloadSize) || range.payloadOffset < 0 || range.payloadSize < 0 || range.payloadOffset > source.size || range.payloadSize > source.size - range.payloadOffset)
    throw new RangeError('Invalid ES descriptor range');
  const iterator = consumeMp4SampleSteps(source, esdsSteps(range), options);
  const result = await iterator.next();
  if (!result.done) { await iterator.return(undefined as never); throw new Error('Unexpected ES descriptor sample'); }
  const { objectTypeIndication, audioObjectType, sampleRate, channelCount, maxBitrate, avgBitrate } = result.value;
  return { objectTypeIndication, audioObjectType, sampleRate, channelCount, maxBitrate, avgBitrate };
}
