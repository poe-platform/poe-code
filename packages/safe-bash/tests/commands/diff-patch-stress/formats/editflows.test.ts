import assert from "node:assert/strict";
import test, {  } from "node:test";
import { verifyIndependentEdit } from "../gnu-target/edit-correctness.js";
import { contextCounts, editflows } from "./fixtures.js";
import { labels, run } from "./helpers.js";

test("corpus has 128 independent inputs, including 14 alignment-ambiguous pairs", () => {
  assert.equal(editflows.length, 128);
  assert.equal(new Set(editflows.map(flow => flow.name)).size, 128);
  assert.equal(editflows.filter(flow => flow.ambiguous).length, 14);
});

for (const [index, flow] of editflows.entries()) {
  for (const format of ["normal", "context"] as const) {
    const context = contextCounts[(index + Math.floor(index / 8)) % contextCounts.length];
    const flags = format === "normal" ? [] : ["-C", String(context)];
    const args = [...flags, ...labels, "old", "new"];
    const expectedStatus = flow.old === flow.next ? 0 : 1;
    const name = `${format}/${flow.name}/C${context}`;


    test(`independent formatter ${name}`, async () => {
      const virtual = await run("diff", args, { files: { old: flow.old, new: flow.next } });
      assert.equal(virtual.exitCode, expectedStatus, virtual.stderr);
      verifyIndependentEdit(flow.old, flow.next, virtual.stdout, format);
    });
  }
}
