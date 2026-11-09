import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8 } from "./binary.js";

for (const [tags, chroma, size] of [
  ["XYSCSS=444", "444", 27],
  ["XYSCSS=422", "422", 21],
  ["XYSCSS=420JPEG", "420jpeg", 17],
  ["XYSCSS=420MPEG2", "420jpeg", 17],
  ["C420jpeg XYSCSS=444", "420jpeg", 17],
  ["XYSCSS=444 C420jpeg", "420jpeg", 17],
  ["", "420jpeg", 17],
  ["XYSCSS=unknown", "420jpeg", 17]
] as const) {
  it(`round trips both 3x3 frames using ${tags || "default chroma"}`, () => {
    const records = concatBytes([128, 160].flatMap(value => [encodeUtf8("FRAME\n"), new Uint8Array(size).fill(value)]));
    const input = concatBytes([encodeUtf8(`YUV4MPEG2 W3 H3 F25:1 Ip A1:1 ${tags}\n`), records]);
    const output = serializeY4m(parseY4m(input));
    const newline = output.indexOf(10);
    assert.ok(new TextDecoder().decode(output.subarray(0, newline)).split(" ").includes(`C${chroma}`));
    assert.deepEqual(output.subarray(newline + 1), records);
  });
}
