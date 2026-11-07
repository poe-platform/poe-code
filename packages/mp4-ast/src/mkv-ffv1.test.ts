import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, probeMkv, serializeMkv } from "./containers/mkv.js";

// Native FFmpeg testsrc2=size=32x24:rate=5:duration=1, setsar=2,
// encoded with -c:v ffv1 -level <version> -threads 1.
for (const version of [1, 3]) {
  it(`preserves FFV1 version ${version} identity, private headers and packets`, () => {
    const bytes = readFileSync(new URL(`./fixtures/ffv1-v${version}.mkv`, import.meta.url));
    const source = parseMkv(new Uint8Array(bytes));
    const original = source.tracks[0]!;
    assert.equal(original.codecDescriptions[0]!.codecName, "ffv1");
    assert.equal(original.codecDescriptions[0]!.formatFourCC, "FFV1");
    assert.equal(Boolean(original.codecDescriptions[0]!.extraData?.length), version === 3);
    const output = serializeMkv(source);
    assert.equal(probeMkv(output).streams[0]!.codec_name, "ffv1");
    const copied = parseMkv(output).tracks[0]!;
    assert.deepEqual(copied.codecDescriptions, original.codecDescriptions);
    assert.equal(copied.samples.length, 5);
    for (const [index, sample] of copied.samples.entries()) {
      const expected = original.samples[index]!;
      for (const key of ["data", "pts", "dts", "duration", "isKeyframe"] as const) {
        assert.deepEqual(sample[key], expected[key]);
      }
    }
  });
}
