import assert from "node:assert/strict";
import test, { before } from "node:test";
import { assertNativeCapture, calibration } from "../gnu-target/calibration.js";
import { verifyIndependentEdit } from "../gnu-target/edit-correctness.js";
import { contextCounts, editflows } from "./fixtures.js";
import { contents, labels, native, patchArgs, run, verifyOracles } from "./helpers.js";

before(async () => { console.log("FORMAT_ORACLES", JSON.stringify(await verifyOracles())); });

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

    const captured = format === "context" && context === 0 ? calibration.formats.find(item => item.name === flow.name) : undefined;

    test(`${captured ? "GNU C0 calibration only" : "native-native control"} ${name}`, async () => {
      const diff = await native("diff", args, { old: flow.old, new: flow.next });
      assert.equal(diff.exitCode, expectedStatus, diff.stderr);
      for (const reverse of [false, true]) {
        const applied = await native("patch", [...(reverse ? ["-R"] : []), ...patchArgs], { target: reverse ? flow.next : flow.old }, diff.stdout);
        if (captured) {
          assert.deepEqual(flow, captured.flow);
          assert.equal(diff.stdout, captured.gnuDiff.stdout);
          const direction = captured.directions.find(item => item.reverse === reverse)!;
          assert.equal(direction.gnu.input, diff.stdout);
          assert.equal(direction.gnu.before.target, reverse ? flow.next : flow.old);
          assertNativeCapture(applied, direction.gnu);
        } else {
          assert.equal(applied.exitCode, 0, `ORACLE FAILURE reverse=${reverse}: ${applied.stderr}${applied.stdout}`);
          assert.equal(applied.target, reverse ? flow.old : flow.next, `ORACLE BYTE FAILURE reverse=${reverse}`);
        }
      }
    });

    test(`independent formatter ${name}`, async () => {
      const virtual = await run("diff", args, { files: { old: flow.old, new: flow.next } });
      assert.equal(virtual.exitCode, expectedStatus, virtual.stderr);
      if (!flow.ambiguous) {
        const oracle = await native("diff", args, { old: flow.old, new: flow.next });
        assert.equal(oracle.exitCode, expectedStatus, oracle.stderr);
        assert.equal(virtual.stdout, oracle.stdout, "exact unique-line GNU expectation");
      }
      verifyIndependentEdit(flow.old, flow.next, virtual.stdout, format);
      for (const reverse of [false, true]) {
        const applied = await native("patch", [...(reverse ? ["-R"] : []), ...patchArgs], { target: reverse ? flow.next : flow.old }, virtual.stdout);
        if (captured && virtual.stdout === captured.gnuDiff.stdout) {
          assert.deepEqual(flow, captured.flow);
          assertNativeCapture(applied, captured.directions.find(item => item.reverse === reverse)!.gnu);
        } else {
          assert.equal(applied.exitCode, 0, "independent GNU patch: " + applied.stderr + applied.stdout);
          assert.equal(applied.target, reverse ? flow.old : flow.next, "independent native patch of virtual output");
        }
      }
    });

    test(`independent parser ${name}`, async () => {
      const oracle = await native("diff", args, { old: flow.old, new: flow.next });
      assert.equal(oracle.exitCode, expectedStatus, oracle.stderr);
      for (const reverse of [false, true]) {
        const applied = await run("patch", [...(reverse ? ["-R"] : []), "target"], { files: { target: reverse ? flow.next : flow.old }, input: oracle.stdout });
        assert.equal(applied.exitCode, 0, `reverse=${reverse}: ${applied.stderr}`);
        assert.equal(await contents(applied.fs), reverse ? flow.old : flow.next, `virtual patch of GNU output reverse=${reverse}`);
      }
    });
  }
}
