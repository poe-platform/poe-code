import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMpegTs } from "./index.js";

it("does not advertise an initial dependent sample as random access when writing its PCR", () => {
  const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 25, frameCount: 2 }));
  const track = source.tracks.find(t => t.type === "video")!;
  const doc = { ...source, tracks: [{ ...track, samples: track.samples.map((s, i) => ({ ...s, isKeyframe: i === 1 })) }] };
  for (const mpegtsOmitRai of [false, true]) {
    const bytes = serializeMpegTs(doc, { mpegtsOmitRai });
    const flags: number[] = [];
    for (let pos = 0; pos < bytes.length; pos += 188) {
      const p = bytes.subarray(pos, pos + 188);
      if ((((p[1]! & 31) << 8) | p[2]!) !== 0x100 || !(p[1]! & 64)) continue;
      flags.push(p[3]! & 32 && p[4] ? p[5]! : 0);
    }
    assert.deepEqual(flags, [0x10, mpegtsOmitRai ? 0x10 : 0x50]);
  }
});
