import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const prefix of ["", " ", "\t", "\\"]) {
  it(`recognizes FFmetadata comments only at the record start: ${JSON.stringify(prefix)}`, () => {
    const tags = `${prefix}#note=one\n${prefix};note=two\nplain=value\n`;
    const chapter = "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\n";
    const input = new TextEncoder().encode(`;FFMETADATA1\n${tags}${chapter}${tags}`);
    const keyPrefix = prefix === "\\" ? "" : prefix;
    const expectedTags = prefix ? { [`${keyPrefix}#note`]: "one", [`${keyPrefix};note`]: "two", plain: "value" } : { plain: "value" };
    const document = parseFfmetadata(input);
    assert.deepEqual(document.metadata.custom, expectedTags);
    assert.deepEqual(document.chapters?.[0]?.tags, expectedTags);
    assert.deepEqual(ffmetadataAst().probe!(input, {}).format.tags, expectedTags);
    const escaped = prefix ? `${keyPrefix}\\#note=one\n${keyPrefix}\\;note=two\nplain=value\n` : "plain=value\n";
    const output = serializeFfmetadata(document);
    assert.equal(new TextDecoder().decode(output), `;FFMETADATA1\n${escaped}${chapter}${escaped}`);
    assert.deepEqual(parseFfmetadata(output).metadata, document.metadata);
  });
}
