import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Vector } from "../jq-42-independent-review/harness.js";
import { execute } from "./harness.js";
const { probes } = JSON.parse(readFileSync(new URL("../jq-42-independent-review/legacy-native-proof.json", import.meta.url), "utf8")) as { probes: Vector[] };
assert.equal(probes.length, 94);
for (const vector of probes) test(`unchanged legacy: ${vector.id}`, { timeout: 10000 }, async () => {
  const transports = ["whole", "bytewise", "size:2", "size:5", "size:7", "size:64", "size:16384"];
  for (let boundary = 0; boundary <= vector.inputHex.length / 2; boundary++) transports.push(`split:${boundary}`);
  for (const route of ["direct", "shell"] as const) for (const transport of transports) {
    const expected = { status: vector.expected.status, stdoutHex: vector.expected.stdoutHex, stderrHex: vector.expected.stderrHex };
    assert.deepEqual(await execute(vector, route, transport), expected, `${route} ${transport}`);
  }
});
