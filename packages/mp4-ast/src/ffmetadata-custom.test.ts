import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

it("preserves custom global FFmetadata tags without treating section tags as globals", () => {
  const document = parseFfmetadata(new TextEncoder().encode([
    ";FFMETADATA1", "title=Demo", "year=2026", "custom_field=note123",
    "MixedCase=value", "empty=", "constructor=tag", "__proto__=data",
    "[STREAM]", "stream_only=ignored"
  ].join("\n")));
  assert.deepEqual(document.metadata.custom, {
    year: "2026", custom_field: "note123", MixedCase: "value", empty: "", constructor: "tag",
    ["__proto__"]: "data"
  });
  assert.equal(document.metadata.title, "Demo");
  assert.equal(document.metadata.date, undefined);
  const output = serializeFfmetadata(document);
  assert.match(new TextDecoder().decode(output), /custom_field=note123\n/);
  assert.deepEqual(parseFfmetadata(output).metadata, document.metadata);
});

for (const date of [undefined, "2005"]) {
  it(`keeps FFmetadata year distinct from date=${date}`, () => {
    const document = parseFfmetadata(new TextEncoder().encode(
      `;FFMETADATA1\nyear=1988\n${date === undefined ? "" : `date=${date}\n`}`
    ));
    assert.equal(document.metadata.custom?.year, "1988");
    assert.equal(document.metadata.date, date);
    const output = new TextDecoder().decode(serializeFfmetadata(document));
    assert.deepEqual(output.trim().split("\n").slice(1).sort(),
      ["year=1988", ...(date === undefined ? [] : [`date=${date}`])].sort());
  });
}
