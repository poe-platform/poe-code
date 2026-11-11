import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [line, key, value] of [
  [String.raw`a\=b=v\=q`, "a=b", "v=q"],
  [String.raw`ab=v\=q`, "ab", "v=q"],
  [String.raw`a\\=v\=q`, "a\\", "v=q"],
  [String.raw`a\\\=b=v\=q`, String.raw`a\=b`, "v=q"]
] as const) {
  it(`preserves escaped FFmetadata keys and values: ${line}`, () => {
    const input = `;FFMETADATA1\n${line}\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\n${line}\n`;
    const document = parseFfmetadata(new TextEncoder().encode(input));
    assert.deepEqual(document.metadata.custom, { [key]: value });
    assert.deepEqual(document.chapters?.[0]?.tags, { [key]: value });
    const output = serializeFfmetadata(document);
    assert.equal(new TextDecoder().decode(output), input);
    assert.deepEqual(parseFfmetadata(output), document);
  });
}
