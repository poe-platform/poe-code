import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// MOV fixture: ffmpeg -i packet-positions-faststart.mp4 -c copy -aspect 16:9 explicit-pixel-aspect.mov
// Aspect ratios independently checked with native ffprobe on the same bytes.
for (const [fixture, width, height, sar, dar] of [
  ['explicit-pixel-aspect.mov', 32, 24, '4:3', '16:9'],
  ['aac-external.mp4', 640, 360, undefined, undefined],
  ['packet-positions-faststart.mp4', 32, 24, '1:1', '4:3']
] as const) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} preserves declared H.264 aspect ratios: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, { syncSamples() {
        const keys = new Set<number>();
        return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
      } });
      const dimensions = [];
      for await (const stream of probe.streams) {
        if (stream.codec_type === 'video') dimensions.push([stream.width, stream.height, stream.sample_aspect_ratio, stream.display_aspect_ratio]);
        else {
          assert.equal(stream.sample_aspect_ratio, undefined);
          assert.equal(stream.display_aspect_ratio, undefined);
        }
      }
      assert.deepEqual(dimensions, [[width, height, sar, dar]]);
    });
  }
}
