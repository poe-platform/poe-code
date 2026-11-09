import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";

const fixture = "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000040000000100000002000000106368616e000000000000000c000100000000000c000000006461746100000000000000140000000003e8232807d01f400bb81b580fa01770";

for (const mask of [3, 12, 0x30, 0x30000]) {
  it(`retains CAF speaker bitmap ${mask} in decoded PCM`, () => {
    const bytes = Buffer.from(fixture, "hex");
    bytes.writeUInt32BE(mask, 68);
    assert.equal(cafAst().parse(bytes).tracks[0]!.decodedAudio!.channelMask, mask);
    assert.equal(cafAst().parse(bytes, { decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
  });
}

for (const [tag, mask] of [[0x10000, 0], [0x10000, 4], [0x10000, 7], [0x10000, 0x40001], [0, 12]]) {
  it(`ignores mismatched or unsupported CAF bitmap ${mask} for tag ${tag}`, () => {
    const bytes = Buffer.from(fixture, "hex");
    bytes.writeUInt32BE(tag!, 64);
    bytes.writeUInt32BE(mask!, 68);
    assert.equal(cafAst().parse(bytes).tracks[0]!.decodedAudio!.channelMask, undefined);
  });
}
