import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata, buildProbeResultFromDoc } from "./index.js";

for (const key of ["title", "artist", "album", "date", "comment", "genre", "encoder"]) {
  for (const input of [`${key.toUpperCase()}=Mixed`, `${key}=one\n${key.toUpperCase()}=two`, `${key.toUpperCase()}=one\n${key}=two`]) {
    it(`preserves the last recognized FFmetadata key spelling: ${input}`, () => {
      const bytes = new TextEncoder().encode(`;FFMETADATA1\n${input}\n`);
      const document = parseFfmetadata(bytes);
      const expected = input.split("\n").at(-1)!;
      assert.equal(new TextDecoder().decode(serializeFfmetadata(document)), `;FFMETADATA1\n${expected}\n`);
      const [name, value] = expected.split("=");
      assert.deepEqual(buildProbeResultFromDoc(document, bytes.length).format.tags, { [name!]: value });
    });
  }
}
