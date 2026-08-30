import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { executeVector, expectedBytes, type Vector } from "../independent-increment/harness.js";

const evidence = JSON.parse(readFileSync(new URL("./native-followup.json", import.meta.url), "utf8")) as { cases: Vector[] };
test("jq42 followup evidence is immutable", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./native-followup.json", import.meta.url))).digest("hex"), "0ea0cb65c0a93715af8a63d185aea63b03c52f4445ff1487ca7bf2595921be83");
});
for (const vector of evidence.cases) for (const transport of ["whole", "bytewise"]) test(`jq42 followup ${vector.id} ${transport}`, async () => {
  assert.deepEqual(await executeVector({ ...vector, transport }), expectedBytes(vector));
});
