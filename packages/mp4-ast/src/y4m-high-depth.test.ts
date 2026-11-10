import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";

for (const [depth, format] of [[10, 68], [16, 49]] as const) {
  for (const [width, height] of [[2, 2], [3, 5]] as const) {
    it(`preserves ${width}x${height} C444p${depth} samples, timing and headers`, () => {
      const payloads = [0, 1].map(frame => {
        const bytes = Buffer.alloc(width * height * 6);
        for (let i = 0; i < bytes.length / 2; i++) bytes.writeUInt16LE((128 + frame + i) << (depth - 10), i * 2);
        return bytes;
      });
      const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F5:1 Ip A1:1 C444p${depth}\n`),
        ...payloads.flatMap(bytes => [Buffer.from("FRAME\n"), bytes])]);
      const doc = parseY4m(input);
      const track = doc.tracks[0]!;
      assert.equal(track.demuxError, undefined);
      assert.equal(track.codecDescriptions[0]!.pixFmt, `yuv444p${depth}le`);
      assert.equal(track.samples.length, 2);
      assert.equal(doc.durationSeconds, 0.4);
      track.decodedVideoFrames!.forEach((frame, i) => {
        assert.equal(frame.native!.format, format);
        assert.deepEqual(frame.native!.pixels, payloads[i]);
        assert.equal(frame.data.length, width * height * 4);
        assert.equal(frame.ptsSeconds, i / 5);
        assert.equal(track.samples[i]!.size, payloads[i]!.length);
      });
      assert.deepEqual(Buffer.from(serializeY4m(doc)), input);
    });
  }
}
