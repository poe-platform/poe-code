import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8, rgbaToYuv420p } from "./binary.js";

const samples = Uint8Array.from([0x10, 0x30, 0x50, 0x70, 0x80, 0x90]);
const input = concatBytes([encodeUtf8("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\nFRAME\n"), samples]);

for (const aspect of ["1:1", "4:3", "0:0"]) {
  it(`preserves Y4M sample aspect ratio ${aspect}`, () => {
    const bytes = concatBytes([encodeUtf8(`YUV4MPEG2 W2 H2 F25:1 Ip A${aspect} C420jpeg\nFRAME\n`), samples]);
    const doc = parseY4m(bytes);
    const codec = doc.tracks[0]!.codecDescriptions[0]!;
    assert.equal(`${codec.sarWidth}:${codec.sarHeight}`, aspect);
    assert.deepEqual(serializeY4m(doc), bytes);
  });
}

it("preserves original YUV420 samples when writing Y4M", () => {
  assert.deepEqual(serializeY4m(parseY4m(input)), input);
});

it("converts edited RGBA instead of reusing stale YUV420 samples", () => {
  const doc = parseY4m(input);
  const frame = doc.tracks[0]!.decodedVideoFrames![0]!;
  const data = new Uint8Array(frame.data.length).fill(255);
  const edited = { ...doc, tracks: [{ ...doc.tracks[0]!, decodedVideoFrames: [{ ...frame, data }] }] };
  const { y, u, v } = rgbaToYuv420p(data, 2, 2);
  assert.deepEqual(serializeY4m(edited).slice(-6), concatBytes([y, u, v]));
});

for (const [interlace, fieldOrder] of [["p", "progressive"], ["t", "tt"], ["b", "bb"]]) {
  it(`preserves Y4M field order I${interlace}`, () => {
    const bytes = concatBytes([encodeUtf8(`YUV4MPEG2 W2 H2 F25:1 I${interlace} A1:1 C420jpeg\nFRAME\n`), samples]);
    const doc = parseY4m(bytes);
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.fieldOrder, fieldOrder);
    assert.deepEqual(serializeY4m(doc), bytes);
  });
}
