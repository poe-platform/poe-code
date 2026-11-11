import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [input, expected] of [
  ["foo=1\nFOO=2", "FOO=2"],
  ["FOO=1\nfoo=2", "foo=2"],
  ["foo=1\nFoO=2\nFOO=3", "FOO=3"],
  ["foo=1\nFOO=", "FOO="],
  ["foo=1\nbar=2", "foo=1\nbar=2"],
  ["__proto__=1\n__PROTO__=2", "__PROTO__=2"]
] as const) {
  it(`retains the latest custom global FFmetadata value and spelling: ${input}`, () => {
    const bytes = new TextEncoder().encode(`;FFMETADATA1\n${input}\n`);
    const document = parseFfmetadata(bytes);
    const tags = Object.fromEntries(expected.split("\n").map(line => line.split("=")));
    assert.deepEqual(document.metadata.custom, tags);
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)), `;FFMETADATA1\n${expected}\n`);
    assert.deepEqual(ffmetadataAst().probe!(bytes, {}).format.tags, tags);
  });
}
