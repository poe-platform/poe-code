import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createSyntheticMp4, parseFlv, parseMp4, serializeFlv } from "./index.js";

it("discovers and copies native FLV MP3 packets without AAC headers", () => {
  // ffmpeg -f lavfi -i testsrc2=s=64x48:r=5:d=2 -f lavfi -i sine=f=880:r=44100:d=2
  // -c:v flv1 -threads 1 -c:a libmp3lame mp3.flv
  const source = new Uint8Array(readFileSync(new URL("./fixtures/mp3.flv", import.meta.url)));
  const doc = parseFlv(source);
  const audio = doc.tracks.find(track => track.type === "audio")!;
  assert.ok(audio);
  assert.equal(audio.codecDescriptions[0]!.codecName, "mp3");
  assert.equal(audio.codecDescriptions[0]!.sampleRate, 44100);
  assert.equal(audio.codecDescriptions[0]!.channels, 1);
  assert.equal(audio.samples.length, 78);
  assert.ok(Math.abs(audio.samples[0]!.duration - 1152 / 44100 * 1000) < 0.001);
  const output = serializeFlv({ ...doc, tracks: [audio] });
  assert.equal(output[24]! >>> 4, 2, "first audio tag is MP3, without a sequence header");
  assert.deepEqual(parseFlv(output).tracks[0], { ...audio, id: 1 });
});

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
