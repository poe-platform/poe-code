import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const title of ["hi\0hidden", "hi"]) {
  it(`terminates FFmetadata values at NUL (${JSON.stringify(title)})`, () => {
    const document = parseFfmetadata(new TextEncoder().encode(`;FFMETADATA1\ntitle=${title}\nartist=Jo\n`));
    assert.equal(document.metadata.title, "hi");
    assert.equal(document.metadata.artist, "Jo");
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)), ";FFMETADATA1\ntitle=hi\nartist=Jo\n");
  });
}
