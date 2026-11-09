import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Native FFmpeg 7.0.2 VP8 fixtures: identical packets with no projection,
// equirectangular, equirectangular yaw=35/pitch=-15/roll=10, or cubemap.
const projections = {
  flat: undefined,
  sphere: "767181017672940000000000000000000000000000000000000000",
  tilted: "7671810176729400000000000000000000000000000000000000007673884041800000000000767488c02e0000000000007675884024000000000000",
  cube: "7671810276728c000000000000000000000000"
};

for (const [name, hex] of Object.entries(projections)) {
  for (const format of ["matroska", "webm"]) {
    it(`${format} preserves native ${name} projection and packet payloads`, () => {
      const source = parseMkv(new Uint8Array(readFileSync(new URL(`./fixtures/projection-${name}.mkv`, import.meta.url))));
      const expected = hex === undefined ? undefined : new Uint8Array(Buffer.from(hex, "hex"));
      assert.deepEqual(source.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes, expected);
      const output = serializeMkv(source, { format });
      if (hex !== undefined) {
        // Check the encoded element independently of the parser.
        const element = Buffer.concat([Buffer.from([0x76, 0x70, 0x80 | hex.length / 2]), Buffer.from(hex, "hex")]);
        assert.ok(Buffer.from(output).includes(element));
      }
      const copied = parseMkv(output);
      assert.deepEqual(copied.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes, expected);
      assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
        source.tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
