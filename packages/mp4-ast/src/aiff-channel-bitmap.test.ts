import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff } from "./containers/aiff.js";

// Four PCM16 frames: [1000,9000], [2000,8000], [3000,7000], [4000,6000].
const fixture = "464f524d0000005241494646434f4d4d000000120002000000040010400bfa000000000000004348414e0000000c000100000000000c0000000053534e4400000018000000000000000003e8232807d01f400bb81b580fa01770";

for (const [mask, layout] of [[12, "2 channels (FC+LFE)"], [3, "stereo"], [0x30, "2 channels (BL+BR)"]] as const) {
  for (const filename of ["in.aiff", "pipe:0"]) {
    it(`retains AIFF CHAN bitmap ${mask} when decoding and probing ${filename}`, () => {
      const bytes = Buffer.from(fixture, "hex");
      bytes.writeUInt32BE(mask, 50);
      const track = parseAiff(bytes, { filename }).tracks[0]!;
      assert.equal(track.decodedAudio!.channelMask, mask);
      assert.equal(track.codecDescriptions[0]!.channelLayout, layout);
      assert.equal(parseAiff(bytes, { filename, decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
      assert.equal(aiffAst().probe(bytes, { filename }).streams[0]!.channel_layout, layout);
    });
  }
}

for (const [tag, mask] of [[0x10000, 0], [0x10000, 4], [0x10000, 0x40001], [0, 12]]) {
  it(`does not assign a mismatched or unsupported CHAN bitmap ${mask} for tag ${tag}`, () => {
    const bytes = Buffer.from(fixture, "hex");
    bytes.writeUInt32BE(tag!, 46);
    bytes.writeUInt32BE(mask!, 50);
    assert.equal(parseAiff(bytes).tracks[0]!.decodedAudio!.channelMask, undefined);
    assert.equal(aiffAst().probe(bytes).streams[0]!.channel_layout, undefined);
  });
}

it("retains CHAN bitmaps for AIFF-C QuickTime IMA audio", () => {
  const bytes = Buffer.alloc(160);
  bytes.set(Buffer.from("464f524d00000090414946434656455200000004a2805140434f4d4d000000180002000000010004400bfa00000000000000696d61340000", "hex"));
  bytes.set(Buffer.from(fixture, "hex").subarray(38, 58), 56);
  bytes.write("SSND", 76);
  bytes.writeUInt32BE(76, 80);
  // Two 34-byte zero IMA packets, following the eight SSND header bytes.
  bytes.writeUInt32BE(bytes.length - 8, 4);
  assert.equal(parseAiff(bytes).tracks[0]!.decodedAudio!.channelMask, 12);
  assert.equal(aiffAst().probe(bytes).streams[0]!.channel_layout, "2 channels (FC+LFE)");
});
