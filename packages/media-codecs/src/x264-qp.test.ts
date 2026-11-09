import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeH264 } from "./index.js";
import { encodeH264Preset } from "./x264-encoder.js";

const frames = Array.from({ length: 4 }, (_, pts) => ({
  y: Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + pts * 13) % 256),
  u: Uint8Array.from({ length: 128 }, (_, i) => (i * 71 + pts * 19) % 256),
  v: Uint8Array.from({ length: 128 }, (_, i) => (i * 29 + pts * 23) % 256), pts, keyframe: false
}));

for (const qp of [0, 1, 9, 18, 35, 51]) {
  it(`uses constant QP ${qp} and flushes all pictures`, () => {
    const packets = [...encodeH264Preset(frames, 32, 16, 24, 1, "medium", -1, qp)];
    const decoded = [...decodeH264(packets.map(packet => ({ ...packet, duration: 1 })), new Uint8Array(), 512)];
    assert.equal(decoded.length, frames.length);
    assert.deepEqual(decoded.map(frame => frame.pts), frames.map(frame => frame.pts));
    decoded.forEach((frame, index) => {
      const source = Buffer.concat([frames[index]!.y, frames[index]!.u, frames[index]!.v]);
      if (qp === 0) assert.deepEqual(Buffer.from(frame.native!.pixels), source);
      else assert.notDeepEqual(Buffer.from(frame.native!.pixels), source);
    });
  });
}

for (const qp of [-2, 52, 1.5, NaN, Infinity]) {
  it(`rejects invalid QP ${qp}`, () => {
    assert.throws(() => [...encodeH264Preset(frames, 32, 16, 24, 1, "medium", -1, qp)], /quantizer/);
  });
}
