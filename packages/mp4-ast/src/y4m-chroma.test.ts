import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8 } from "./binary.js";

for (const [chroma, location] of [["420mpeg2", "left"], ["420jpeg", "center"]]) {
  it(`preserves Y4M ${chroma} chroma placement and samples`, () => {
    const samples = new Uint8Array(6).fill(128);
    const input = concatBytes([encodeUtf8(`YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C${chroma}\nFRAME\n`), samples]);
    const doc = parseY4m(input);
    const output = serializeY4m(doc);
    const fields = new TextDecoder().decode(output.subarray(0, output.indexOf(10))).split(" ");
    assert.ok(fields.includes(`C${chroma}`));
    if (chroma === "420mpeg2") assert.ok(fields.includes("XYSCSS=420MPEG2"));
    assert.ok(fields.includes("W2"));
    assert.ok(fields.includes("H2"));
    assert.deepEqual(output.slice(-6), samples);
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.chromaLocation, location);
  });
}
