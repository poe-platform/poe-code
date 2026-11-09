import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const key of ["title", "artist", "album", "date", "comment", "copyright", "genre", "encoder"]) {
  for (const value of ["", "one"]) {
    it(`preserves present ${key}=${JSON.stringify(value)} when serializing FFmetadata`, () => {
      const document = parseFfmetadata(new TextEncoder().encode(";FFMETADATA1\n"));
      assert.equal(new TextDecoder().decode(serializeFfmetadata({ ...document, metadata: { [key]: value } })), `;FFMETADATA1\n${key}=${value}\n`);
    });
  }
}

it("omits absent global FFmetadata tags", () => {
  const document = parseFfmetadata(new TextEncoder().encode(";FFMETADATA1\n"));
  assert.equal(new TextDecoder().decode(serializeFfmetadata(document)), ";FFMETADATA1\n");
});
