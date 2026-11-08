import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Dimensions independently checked with native ffprobe on the same bytes.
for (const [fixture, width, height] of [
  ['packet-positions-faststart', 32, 24],
  ['packet-positions-interleaved', 32, 24],
  ['packet-positions-fragmented', 32, 24],
  ['h264-edit-list', 32, 24],
  ['aac-external', 640, 360],
  ['h264-b-frames', 64, 48]
] as const) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} reports native H.264 coded dimensions: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, { syncSamples() {
        const keys = new Set<number>();
        return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
      } });
      const dimensions = [];
      for await (const stream of probe.streams) {
        if (stream.codec_type === 'video') dimensions.push([stream.width, stream.height, stream.coded_width, stream.coded_height]);
        else assert.equal(stream.coded_height, undefined);
      }
      assert.deepEqual(dimensions, [[width, height, width, height]]);
    });
  }
}
