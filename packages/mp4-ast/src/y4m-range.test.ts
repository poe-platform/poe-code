import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";

for (const range of ["FULL", "LIMITED", undefined]) {
  it(`decodes Y4M ${range ?? "unspecified"} range without changing the original samples`, () => {
    const input = Buffer.concat([
      Buffer.from(`YUV4MPEG2 W4 H2 F1:1 Ip C420jpeg${range ? ` XCOLORRANGE=${range}` : ""}\nFRAME\n`),
      Buffer.from([16, 64, 128, 235, 16, 64, 128, 235, 128, 128, 128, 128])
    ]);
    const doc = parseY4m(input);
    const frame = doc.tracks[0]!.decodedVideoFrames![0]!;
    const gray = range === "FULL" ? [16, 64, 128, 235] : [0, 56, 130, 255];
    assert.deepEqual([...frame.data], [...gray, ...gray].flatMap(value => [value, value, value, 255]));
    assert.equal(frame.native!.fullRange, range === "FULL" ? 1 : 0);
    assert.deepEqual([...serializeY4m(doc).slice(-12)], [...input.slice(-12)]);
  });
}

it("uses full-range chroma coefficients for colored Y4M samples", () => {
  const input = Buffer.concat([
    Buffer.from("YUV4MPEG2 W2 H2 F1:1 Ip C420jpeg XCOLORRANGE=FULL\nFRAME\n"),
    Buffer.from([128, 128, 128, 128, 90, 180])
  ]);
  const frame = parseY4m(input).tracks[0]!.decodedVideoFrames![0]!;
  // BT.601 full range: R=Y+1.402V, G=Y-0.344136U-0.714136V, B=Y+1.772U.
  assert.deepEqual([...frame.data], Array.from({ length: 4 }, () => [201, 104, 61, 255]).flat());
});
