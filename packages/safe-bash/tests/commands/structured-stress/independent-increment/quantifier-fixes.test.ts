import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allVectors, digest, executeBytes, executeVector, expectedBytes, type Vector } from "./harness.js";

const additiveBytes = readFileSync(new URL("./phase2-vectors.json", import.meta.url));
const additive = (JSON.parse(additiveBytes.toString()) as { cases: Vector[] }).cases;
test("pre-fix additive native evidence remains immutable", () => {
  assert.equal(digest(additiveBytes), "afcfae94201a04a4455e7410371bfbdcfbe35823939569cc13786779dfaca101");
});
for (const vector of [...allVectors.filter(item => item.category === "object-iteration"), ...additive.filter(item => item.category === "quantifier-generator")]) {
  test(`quantifier native bytes: ${vector.id}`, async () => {
    assert.deepEqual(await executeVector(vector), expectedBytes(vector));
  });
}
test("empty quantifier conditions cannot catch exhaustion of the shared step budget", async () => {
  for (const filter of ["any(range(100000);empty)?", "all(range(100000);empty)?"]) {
    const result = await executeBytes(["-nc", filter], Buffer.alloc(0), { limits: { maxSteps: 128 } });
    assert.equal(result.status, 5);
    assert.equal(result.stdoutHex, "");
    assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxSteps/);
  }
});
test("generator quantifiers remain cancellable without emitting a result", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("quantifier cancellation")), 10);
  try {
    await assert.rejects(executeBytes(["-nc", "any(range(10000000);empty)?"], Buffer.alloc(0), { limits: { maxSteps: 100000000 } }, { signal: controller.signal }), /quantifier cancellation/);
  } finally { clearTimeout(timer); }
});
