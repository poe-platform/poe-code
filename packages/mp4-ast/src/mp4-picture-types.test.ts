import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMp4, probeMp4, scanMp4Frames, serializeMp4 } from './index.js';

// libx264 testsrc2=size=64x48:rate=10:duration=0.5, -g 20 -bf 3,
// -x264-params b-adapt=0:scenecut=0. Native ffprobe reports I,B,B,B,P.
for (const fragmented of [false, true]) {
  test(`does not infer picture types from MP4 sync flags, fragmented=${fragmented}`, async () => {
    const fixture = readFileSync(new URL('./fixtures/h264-picture-types.mp4', import.meta.url));
    const bytes = fragmented ? serializeMp4(parseMp4(fixture), { fragmented }) : fixture;
    const frames = [];
    for await (const frame of scanMp4Frames({
      size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + length); }
    }, { syncSamples() {
      const keys = new Set<number>();
      return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
    } })) frames.push(frame);
    for (const result of [frames, probeMp4(bytes, { showFrames: true }).frames!]) {
      assert.equal(result.length, 5);
      assert.equal(result.filter(frame => frame.key_frame === 1).length, 1);
      // Container sync flags do not establish any frame's slice type.
      assert.ok(result.every(frame => frame.pict_type === undefined));
    }
  });
}
