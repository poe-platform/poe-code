import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeVector, expectedBytes, type Vector } from "../independent-increment/harness.js";

const evidence = JSON.parse(readFileSync(new URL("./native-followup.json", import.meta.url), "utf8")) as { cases: Vector[] };
for (const vector of evidence.cases) for (const transport of ["whole", "bytewise"]) test(`jq42 followup ${vector.id} ${transport}`, async () => {
  assert.deepEqual(await executeVector({ ...vector, transport }), expectedBytes(vector));
});
