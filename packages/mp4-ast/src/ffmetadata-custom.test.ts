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
    custom_field: "note123", MixedCase: "value", empty: "", constructor: "tag",
    ["__proto__"]: "data"
  });
  assert.equal(document.metadata.title, "Demo");
  assert.equal(document.metadata.date, "2026");
  const output = serializeFfmetadata(document);
  assert.match(new TextDecoder().decode(output), /custom_field=note123\n/);
  assert.deepEqual(parseFfmetadata(output).metadata, document.metadata);
});
