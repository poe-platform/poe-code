import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseFlv, parseMp4, serializeFlv } from "./index.js";

for (const streams of ["both", "video", "audio"] as const) {
  it(`writes ${streams} FLV tags in decode order without changing packets`, () => {
    const source = parseMp4(createSyntheticMp4({
      width: 32, height: 32, fps: 5, frameCount: 3, includeAudio: true
    }));
    const doc = {
      ...source,
      tracks: source.tracks.filter(track => streams === "both" || track.type === streams).map(track => ({
        ...track,
        samples: track.type === "video" ? track.samples.map((sample, index) => ({
          ...sample,
          dts: sample.dts + track.timescale * 0.023,
          cts: (index === 1 ? -0.02 : 0.04) * track.timescale,
          pts: sample.dts + track.timescale * (index === 1 ? 0.003 : 0.063)
        })) : track.samples
      }))
    };
    const bytes = serializeFlv(doc);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let previous = 0;
    let packets = 0;
    const headers = new Set<number>();
    for (let offset = 13; offset < bytes.length;) {
      const type = bytes[offset]!;
      const size = view.getUint32(offset) & 0xffffff;
      const timestamp = (view.getUint32(offset + 4) >>> 8) + bytes[offset + 7]! * 0x1000000;
      assert.ok(timestamp >= previous, `tag ${type} at ${timestamp}ms follows ${previous}ms`);
      previous = timestamp;
      const packetType = bytes[offset + 12]!;
      if (packetType === 0) headers.add(type);
      if (packetType === 1) {
        assert.ok(headers.has(type), "codec header precedes packets");
        packets++;
      }
      assert.equal(view.getUint32(offset + 11 + size), 11 + size);
      offset += 15 + size;
    }
    assert.equal(packets, doc.tracks.reduce((count, track) => count + track.samples.length, 0));
    const parsed = parseFlv(bytes);
    for (const expected of doc.tracks) {
      const actual = parsed.tracks.find(track => track.type === expected.type)!;
      assert.deepEqual(actual.samples.map(sample => [...sample.data]), expected.samples.map(sample => [...sample.data]));
      assert.deepEqual(actual.samples.map(sample => sample.dts), expected.samples.map(sample => Math.round(sample.dts / expected.timescale * 1000)));
      assert.deepEqual(actual.samples.map(sample => sample.cts), expected.samples.map(sample => Math.round(sample.cts / expected.timescale * 1000)));
    }
  });
}
