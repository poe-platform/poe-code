import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const count of [1, 2, 3, 4]) {
  it(`consumes an unpaired escape at EOF after ${count} backslashes`, () => {
    const input = ";FFMETADATA1\na=b" + "\\".repeat(count);
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)),
      ";FFMETADATA1\na=b" + "\\".repeat(count - count % 2) + "\n");
  });
}
