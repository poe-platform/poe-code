import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseAvi, serializeAvi } from "./index.js";

// Native FFmpeg fixture: 32x24 MJPEG at 5 fps, plus mono 8 kHz PCM
// sine waves at 440 Hz and 880 Hz, each one second long.
const input = parseAvi(new Uint8Array(readFileSync(new URL("./fixtures/multitrack.avi", import.meta.url))));

it("reads the global title from native AVI INFO metadata", () => {
  assert.equal(input.metadata.title, "Meeting");
});

for (const title of ["Meeting", "Even", "Réunion", undefined]) {
  it(`preserves AVI title ${title} with RIFF padding and termination`, () => {
    const bytes = serializeAvi({ ...input, metadata: title === undefined ? {} : { title } });
    assert.equal(parseAvi(bytes).metadata.title, title);
    const buffer = Buffer.from(bytes);
    const offset = buffer.indexOf("INAM");
    if (title === undefined) {
      assert.equal(offset, -1);
    } else {
      const payload = Buffer.from(`${title}\0`);
      assert.equal(buffer.readUInt32LE(offset + 4), payload.length);
      assert.deepEqual(buffer.subarray(offset + 8, offset + 8 + payload.length), payload);
    }
  });
}

for (const order of [[0, 1, 2], [2, 0, 1], [2, 1], [2], [0, 0, 1, 2]]) {
  it(`AVI preserves mapped tracks in order ${order}`, () => {
    const tracks = order.map(index => input.tracks[index]!);
    const bytes = serializeAvi({ ...input, tracks });
    const result = parseAvi(bytes);
    assert.equal(result.tracks.length, tracks.length);
    for (const [index, expected] of tracks.entries()) {
      const actual = result.tracks[index]!;
      assert.equal(actual.type, expected.type);
      assert.equal(actual.codecDescriptions[0]!.codecName, expected.codecDescriptions[0]!.codecName);
      assert.deepEqual(actual.samples.map(sample => sample.data), expected.samples.map(sample => sample.data));
    }

    // Check the stream count and every index entry independently of our parser.
    const buffer = Buffer.from(bytes);
    assert.equal(buffer.readUInt32LE(buffer.indexOf("avih") + 32), tracks.length);
    const movi = buffer.indexOf("movi");
    const idx1 = buffer.indexOf("idx1");
    const ids: string[] = [];
    for (let pos = idx1 + 8; pos < buffer.length; pos += 16) {
      const id = buffer.toString("ascii", pos, pos + 4);
      const offset = buffer.readUInt32LE(pos + 8);
      const length = buffer.readUInt32LE(pos + 12);
      assert.equal(buffer.toString("ascii", movi + offset, movi + offset + 4), id);
      assert.equal(buffer.readUInt32LE(movi + offset + 4), length);
      ids.push(id);
    }
    assert.deepEqual(ids, tracks.flatMap((track, index) =>
      track.samples.map(() => `${String(index).padStart(2, "0")}${track.type === "audio" ? "wb" : "dc"}`)));
  });
}

it("rejects stream counts that cannot fit AVI chunk identifiers", () => {
  assert.throws(() => serializeAvi({ ...input, tracks: Array.from({ length: 101 }, () => input.tracks[1]!) }),
    /at most 100 streams/);
});

for (const audioTail of [false, true]) {
  for (const [rate, scale] of [[5, 2], [30000, 1001], [25, 1], [1, 2]] as const) {
    it(`preserves AVI video timing at ${rate}/${scale} fps with audio tail ${audioTail}`, () => {
      const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 12 }));
      const track = source.tracks[0]!;
      const samples = track.samples.map((sample, index) => ({
        ...sample, dts: index * scale, pts: index * scale, cts: 0, duration: scale
      }));
      const duration = samples.length * scale;
      const bytes = Buffer.from(serializeAvi({
        ...source, durationSeconds: duration / rate + (audioTail ? 2 : 0),
        tracks: [{ ...track, timescale: rate, duration, samples },
          ...(audioTail ? [{ ...input.tracks[1]!,
            duration: (duration / rate + 2) * input.tracks[1]!.timescale }] : [])]
      }));
      const strh = bytes.indexOf("strh");
      assert.equal(bytes.readUInt32LE(strh + 28), scale);
      assert.equal(bytes.readUInt32LE(strh + 32), rate);
      assert.equal(bytes.readUInt32LE(strh + 40), samples.length);
      assert.equal(bytes.readUInt32LE(bytes.indexOf("avih") + 8), Math.round(1_000_000 * scale / rate));
    });
  }
}
