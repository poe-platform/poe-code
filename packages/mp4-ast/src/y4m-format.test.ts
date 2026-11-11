import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8 } from "./binary.js";

for (const chroma of ["nonsense", "", "420jpeg-invalid", "420p99", "MONO"]) {
  it(`rejects unknown Y4M pixel format C${chroma}`, () => {
    const input = concatBytes([encodeUtf8(`YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C${chroma}\n`),
      ...[128, 160].flatMap(value => [encodeUtf8("FRAME\n"), new Uint8Array(6).fill(value)])]);
    assert.throws(() => parseY4m(input), /YUV4MPEG stream contains an unknown pixel format/);
  });
}

it("preserves both C420jpeg frames and their source bytes", () => {
  const input = concatBytes([encodeUtf8("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C420jpeg XYSCSS=420JPEG\n"),
    ...[128, 160].flatMap(value => [encodeUtf8("FRAME\n"), new Uint8Array(6).fill(value)])]);
  assert.deepEqual(serializeY4m(parseY4m(input)), input);
});
