import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { concatBytes } from "./binary.js";
import { writeVintSize } from "./containers/ebml.js";

function makeEbmlElement(id: number, payload: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  do { bytes.unshift(id % 256); id = Math.floor(id / 256); } while (id);
  return concatBytes([Uint8Array.from(bytes), writeVintSize(payload.length), payload]);
}
const makeEbmlUint = (id: number, value: number) => makeEbmlElement(id, Uint8Array.of(value));
const makeEbmlString = (id: number, value: string) => makeEbmlElement(id, new TextEncoder().encode(value));
function makeEbmlFloat(id: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return makeEbmlElement(id, bytes);
}

it("preserves native PCM tracks and packet bytes when copying Matroska", () => {
  const source = parseMkv(readFileSync(new URL("./fixtures/track-dispositions.mkv", import.meta.url)));
  const copied = parseMkv(serializeMkv(source));
  const audio = source.tracks.filter(track => track.type === "audio");
  assert.equal(audio.length, 2);
  for (const original of audio) {
    const track = copied.tracks.find(track => track.id === original.id)!;
    assert.equal(original.codecDescriptions[0]!.codecName, "pcm_s16le");
    assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
    for (const key of ["sampleRate", "channels", "bitsPerSample"] as const) {
      assert.equal(track.codecDescriptions[0]![key], original.codecDescriptions[0]![key]);
    }
    assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)), original.samples.map(sample => Buffer.from(sample.data)));
  }
});

for (const [codecId, bits, codecName] of [
  ["A_PCM/INT/LIT", 16, "pcm_s16le"],
  ["A_PCM/INT/LIT", 24, "pcm_s24le"],
  ["A_PCM/INT/BIG", 32, "pcm_s32be"],
  ["A_PCM/FLOAT/IEEE", 32, "pcm_f32le"],
  ["A_PCM/FLOAT/IEEE", 64, "pcm_f64le"]
] as const) {
  it(`preserves ${codecId} with ${bits}-bit samples`, () => {
    const bytes = concatBytes([
      makeEbmlElement(0x1a45dfa3, new Uint8Array()),
      makeEbmlElement(0x18538067, makeEbmlElement(0x1654ae6b,
        makeEbmlElement(0xae, concatBytes([
          makeEbmlUint(0xd7, 1), makeEbmlUint(0x83, 2), makeEbmlString(0x86, codecId),
          makeEbmlElement(0xe1, concatBytes([
            makeEbmlFloat(0xb5, 8000), makeEbmlUint(0x9f, 2), makeEbmlUint(0x6264, bits)
          ]))
        ]))))
    ]);
    const parsed = parseMkv(bytes);
    assert.equal(parsed.tracks[0]!.codecDescriptions[0]!.codecName, codecName);
    const copied = serializeMkv(parsed);
    assert.ok(Buffer.from(copied).includes(Buffer.from(codecId)));
    assert.deepEqual(parseMkv(copied).tracks[0]!.codecDescriptions, parsed.tracks[0]!.codecDescriptions);
  });
}
