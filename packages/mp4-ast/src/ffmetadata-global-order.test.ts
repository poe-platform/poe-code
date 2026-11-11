import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const tags of [
  "artist=Pat\ntitle=Album\n",
  "foo=1\ntitle=A\nbar=2\nartist=B\n",
  "2=A\n1=B\n",
  "title=A\nartist=B\n",
  "2=A\nARTIST=Pat\n1=B\ntitle=Album\nempty=\n"
]) {
  it(`preserves global FFmetadata tag order: ${JSON.stringify(tags)}`, () => {
    const input = `;FFMETADATA1\n${tags}`;
    const document = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)), input);
  });
}
