import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Native ffprobe values include encoder lead-in in the sample duration.
for (const [fixture, video, audio] of [
  ['packet-positions-interleaved', '11224', '28588'],
  ['aac-external', '22691', '70312']
] as const) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} AAC bitrate matches native ffprobe: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, { syncSamples: () => {
        const samples = new Set<number>();
        return { add(sample) { samples.add(sample); }, has(sample) { return samples.has(sample); } };
      } });
      const streams = [];
      for await (const stream of probe.streams) streams.push({ index: stream.index, codec_type: stream.codec_type, bit_rate: stream.bit_rate });
      assert.deepEqual(streams, [
        { index: 0, codec_type: 'video', bit_rate: video },
        { index: 1, codec_type: 'audio', bit_rate: audio }
      ]);
    });
  }
}
