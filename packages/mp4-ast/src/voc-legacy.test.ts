import assert from "node:assert/strict";
import { it } from "node:test";
import { vocAst } from "./containers/voc.js";

const header = Buffer.from("437265617469766520566f6963652046696c651a1a0014011f11", "hex");

it("bounds VOC packets to 2048 bytes while preserving source positions and timestamps", () => {
  const input = Buffer.concat([header, Buffer.from("018a13008300", "hex"), Buffer.alloc(5000), Buffer.from([0])]);
  const track = vocAst().parse(input).tracks[0]!;
  assert.deepEqual(track.samples.map(({ offset, size, pts, duration }) => ({ offset, size, pts, duration })), [
    { offset: 32, size: 2048, pts: 0, duration: 2048 },
    { offset: 2080, size: 2048, pts: 2048, duration: 2048 },
    { offset: 4128, size: 904, pts: 4096, duration: 904 }
  ]);
});

it("rejects short legacy headers, unsupported codecs and orphan continuations", () => {
  for (const [hex, error] of [
    ["0101000083", /Invalid VOC sound block/],
    ["0803000080c100", /Invalid VOC extended block/],
    ["01030000830180", /Unsupported VOC audio encoding/],
    ["0201000080", /continuation without sound format/],
    ["01060000830000", /Truncated VOC block/]
  ] as const) {
    const input = Buffer.concat([header, Buffer.from(hex, "hex")]);
    assert.throws(() => vocAst().parse(input), error);
  }
});
