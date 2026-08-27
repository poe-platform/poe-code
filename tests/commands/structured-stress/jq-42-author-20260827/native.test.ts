import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeVector, expectedBytes, type Vector } from "../independent-increment/harness.js";

const evidence = JSON.parse(readFileSync(new URL("./native-before.json", import.meta.url), "utf8")) as { regressions: Vector[] };
for (const vector of evidence.regressions) for (const transport of ["whole", "bytewise"]) test(`jq42 author ${vector.id} ${transport}`, async () => {
  assert.deepEqual(await executeVector({ ...vector, transport }), expectedBytes(vector));
});
