import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream } from "./index.js";

const bytes = Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64");

it("reads INFO tags through buffered, ranged, and sequential WAV APIs", async () => {
  const expected = { title: "Old title", artist: "Player" };
  assert.deepEqual(parseWav(bytes).metadata, expected);
  const ranged = await probeWavSource({ size: bytes.length, async read(offset, length) {
    return bytes.subarray(offset, offset + Math.min(length, 3));
  } });
  const streamed = await probeWavStream((async function* () {
    for (let offset = 0; offset < bytes.length; offset += 3) yield bytes.subarray(offset, offset + 3);
  })());
  assert.deepEqual(ranged.format.tags, expected);
  assert.deepEqual(streamed.format.tags, expected);
});

it("rejects INFO subchunks extending beyond their LIST", () => {
  const malformed = Buffer.from(bytes);
  malformed.writeUInt32LE(100, 52);
  assert.throws(() => parseWav(malformed), /INFO exceeds LIST bounds/);
});
