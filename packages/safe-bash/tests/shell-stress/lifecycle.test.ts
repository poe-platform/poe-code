import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtual } from "./helpers.js";
import { probeNames } from "./probes.js";

for (const probe of probeNames) {
  test(`isolated shell contract: ${probe}`, async () => {
    assert.deepEqual(await runVirtual({ kind: "probe", probe }), { passed: probe });
  });
}
