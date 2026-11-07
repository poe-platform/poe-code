import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Generated with native FFmpeg/libvpx-vp9 from testsrc2=s=32x24:r=5:d=1,
// setparams=color_primaries=bt2020:colorspace=bt2020nc:color_trc=smpte2084.
const hdr = readFileSync(new URL("./fixtures/vp9-hdr.webm", import.meta.url));

for (const format of ["webm", "matroska"]) {
  it(`${format} retains native HDR Colour fields and coded samples`, () => {
    const source = parseMkv(new Uint8Array(hdr));
    const colour = source.tracks[0]!.codecDescriptions[0]!.rawMkvColourBytes;
    assert.deepEqual(colour, new Uint8Array([
      0x55, 0xba, 0x81, 16, // TransferCharacteristics: SMPTE ST 2084
      0x55, 0xb1, 0x81, 9, // MatrixCoefficients: BT.2020 non-constant
      0x55, 0xbb, 0x81, 9, // Primaries: BT.2020
      0x55, 0xb9, 0x81, 1 // Range: broadcast
    ]));
    const copied = parseMkv(serializeMkv(source, { format }));
    assert.deepEqual(copied.tracks[0]!.codecDescriptions[0]!.rawMkvColourBytes, colour);
    assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
      source.tracks[0]!.samples.map(sample => sample.data));
  });
}

it("does not add Colour signaling when the input has none", () => {
  const source = parseMkv(new Uint8Array(hdr));
  const track = source.tracks[0]!;
  const withoutColour = { ...source, tracks: [{ ...track, codecDescriptions: [
    { ...track.codecDescriptions[0]!, rawMkvColourBytes: undefined }
  ] }] };
  const copied = parseMkv(serializeMkv(withoutColour));
  assert.equal(copied.tracks[0]!.codecDescriptions[0]!.rawMkvColourBytes, undefined);
});
