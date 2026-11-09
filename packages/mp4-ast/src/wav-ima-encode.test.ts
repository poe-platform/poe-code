import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeImaWav } from "./containers/wav-ima.js";

// Native FFmpeg 9.0.1 payloads for PCM16 ramps i % 13 - 6; stereo
// uses the opposite sign in the second channel. Includes zero-padded tails.
for (const [channels, count, hash] of [
  [1, 9, "dbb373355a474f4324bab2f15bb4b7d46a9cba6fecc5db7f5481c0d894e7f360"],
  [1, 2041, "ff190c0fb7c4aa30ebc8a8644f9c71cce15e09146a56d8da3f28c31828f7ff56"],
  [1, 2050, "71be011db094f20e204c627b56cfe7c8b4fc2f74f3de8776a382e47e46a571cc"],
  [2, 9, "b3ad513183184e2d9aa6260fcdbf1470b47a9e089ba194517556dfb13aa4f634"],
  [2, 2041, "3f689cf5b90bad33c044497b5ef58548d704be0383618604939e484d45886a36"],
  [2, 2050, "1746ea8ae7b528e590334e604c6ce53a9713c303e924db56f96bbe7d2d3bc2b1"]
] as const) {
  it(`matches native IMA WAV encoding for ${count} small PCM changes in ${channels} channels`, () => {
    const samples = Array.from({ length: channels }, (_, ch) =>
      Float32Array.from({ length: count }, (_, i) => (i % 13 - 6) * (ch ? -1 : 1) / 32768));
    const encoded = encodeImaWav(samples, 1024);
    assert.equal(createHash("sha256").update(encoded).digest("hex"), hash);
  });
}

it("preserves a complete silent IMA WAV block", () => {
  assert.deepEqual(encodeImaWav([new Float32Array(2041)], 1024), new Uint8Array(1024));
});
