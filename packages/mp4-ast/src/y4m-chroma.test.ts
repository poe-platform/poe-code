import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8, rgbaToYuv420p } from "./binary.js";

for (const [chroma, location] of [["420mpeg2", "left"], ["420jpeg", "center"]]) {
  it(`preserves Y4M ${chroma} chroma placement and samples`, () => {
    const samples = new Uint8Array(6).fill(128);
    const input = concatBytes([encodeUtf8(`YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C${chroma}\nFRAME\n`), samples]);
    const doc = parseY4m(input);
    const output = serializeY4m(doc);
    const fields = new TextDecoder().decode(output.subarray(0, output.indexOf(10))).split(" ");
    assert.ok(fields.includes(`C${chroma}`));
    assert.ok(fields.includes(chroma === "420mpeg2" ? "XYSCSS=420MPEG2" : "XYSCSS=420JPEG"));
    assert.ok(fields.includes("W2"));
    assert.ok(fields.includes("H2"));
    assert.deepEqual(output.slice(-6), samples);
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.chromaLocation, location);
  });
}

for (const [chroma, pixFmt, format, horizontal, vertical] of [
  ["mono", "gray", 8, 0, 0],
  ["422", "yuv422p", 4, 2, 1],
  ["444", "yuv444p", 5, 1, 1]
] as const) {
  for (const [width, height] of [[2, 2], [3, 3]] as const) {
    it(`round trips two ${width}x${height} ${chroma} frames with exact planes`, () => {
      const size = width * height + (horizontal ? 2 * Math.ceil(width / horizontal) * Math.ceil(height / vertical) : 0);
      const payloads = [128, 160].map(value => Uint8Array.from({ length: size }, (_, i) => value + i));
      const input = concatBytes([encodeUtf8(`YUV4MPEG2 W${width} H${height} F25:1 Ip A1:1 C${chroma}${chroma === "mono" ? "" : ` XYSCSS=${chroma}`}\n`),
        ...payloads.flatMap(payload => [encodeUtf8("FRAME\n"), payload])]);
      const doc = parseY4m(input);
      assert.equal(doc.tracks[0]!.codecDescriptions[0]!.pixFmt, pixFmt);
      const frames = doc.tracks[0]!.decodedVideoFrames!;
      assert.equal(frames.length, 2);
      frames.forEach((frame, i) => {
        assert.equal(frame.native!.format, format);
        assert.deepEqual(frame.native!.pixels, payloads[i]);
      });
      assert.deepEqual(serializeY4m(doc), input);
    });
  }
}

it("writes matching 4:2:0 planes when one native 4:4:4 frame is edited", () => {
  const input = concatBytes([encodeUtf8("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C444\n"),
    ...[128, 160].flatMap(value => [encodeUtf8("FRAME\n"), new Uint8Array(12).fill(value)])]);
  const doc = parseY4m(input);
  const track = doc.tracks[0]!;
  const frames = track.decodedVideoFrames!.map((frame, i) => i === 0 ? { ...frame, data: frame.data.slice() } : frame);
  const output = serializeY4m({ ...doc, tracks: [{ ...track, decodedVideoFrames: frames }] });
  const expected = concatBytes([encodeUtf8("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C420jpeg XYSCSS=420JPEG\n"),
    ...frames.flatMap(frame => {
      const { y, u, v } = rgbaToYuv420p(frame.data, 2, 2);
      return [encodeUtf8("FRAME\n"), y, u, v];
    })]);
  assert.deepEqual(output, expected);
});
