import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { executeVector, expectedBytes, type Vector } from "../independent-increment/harness.js";

const evidence = JSON.parse(readFileSync(new URL("./native-before.json", import.meta.url), "utf8")) as { regressions: Vector[] };
test("jq42 native-before evidence is immutable", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./native-before.json", import.meta.url))).digest("hex"), "5590f623d2eb0e70b8e865ad2b3e558ca278a9efd17ccb8113eba1b68409977e");
});
for (const vector of evidence.regressions) for (const transport of ["whole", "bytewise"]) test(`jq42 author ${vector.id} ${transport}`, async () => {
  assert.deepEqual(await executeVector({ ...vector, transport }), expectedBytes(vector));
});
