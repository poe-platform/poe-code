import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Native ffprobe reports zero sample bit depth for compressed AAC.
for (const fixture of [
  'aac-external', 'packet-positions-fragmented'
] as const) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} AAC sample bit depth matches native ffprobe: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, { syncSamples: () => {
        const samples = new Set<number>();
        return { add(sample) { samples.add(sample); }, has(sample) { return samples.has(sample); } };
      } });
      const streams = [];
      for await (const stream of probe.streams) streams.push({ index: stream.index, codec_type: stream.codec_type, bits_per_sample: stream.bits_per_sample });
      assert.deepEqual(streams, [
        { index: 0, codec_type: 'video', bits_per_sample: undefined },
        { index: 1, codec_type: 'audio', bits_per_sample: 0 }
      ]);
    });
  }
}
