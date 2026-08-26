import assert from "node:assert/strict";
import test, { before } from "node:test";
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

    test(`native-native control ${name}`, async () => {
      const diff = await native("diff", args, { old: flow.old, new: flow.next });
      assert.equal(diff.exitCode, expectedStatus, diff.stderr);
      for (const reverse of [false, true]) {
        const applied = await native("patch", [...(reverse ? ["-R"] : []), ...patchArgs], { target: reverse ? flow.next : flow.old }, diff.stdout);
        assert.equal(applied.exitCode, 0, `ORACLE FAILURE reverse=${reverse}: ${applied.stderr}${applied.stdout}`);
        assert.equal(applied.target, reverse ? flow.old : flow.next, `ORACLE BYTE FAILURE reverse=${reverse}`);
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
      let forward = await native("patch", patchArgs, { target: flow.old }, virtual.stdout);
      let reverse = await native("patch", ["-R", ...patchArgs], { target: flow.next }, virtual.stdout);
      if (forward.exitCode !== 0 || reverse.exitCode !== 0) {
        const oracle = await native("diff", args, { old: flow.old, new: flow.next });
        const control = await native("patch", patchArgs, { target: flow.old }, oracle.stdout);
        const reversedControl = await native("patch", ["-R", ...patchArgs], { target: flow.next }, oracle.stdout);
        if (control.exitCode !== 0 || reversedControl.exitCode !== 0) {
          console.log("DIALECT_CONTROL", JSON.stringify({ name, gnuForward: control.exitCode, gnuReverse: reversedControl.exitCode, fallback: "Apple forward/reverse only after both native-native controls pass" }));
          const appleArgs = ["-f", "-F0", "target"];
          const appleControl = await native("patch", appleArgs, { target: flow.old }, oracle.stdout, true);
          const appleReverseControl = await native("patch", ["-R", ...appleArgs], { target: flow.next }, oracle.stdout, true);
          assert.equal(appleControl.exitCode, 0, "ORACLE BLOCKED: Apple forward control failed too");
          assert.equal(appleReverseControl.exitCode, 0, "ORACLE BLOCKED: Apple reverse control failed too");
          assert.equal(appleControl.target, flow.next, "ORACLE BLOCKED: Apple forward bytes");
          assert.equal(appleReverseControl.target, flow.old, "ORACLE BLOCKED: Apple reverse bytes");
          forward = await native("patch", appleArgs, { target: flow.old }, virtual.stdout, true);
          reverse = await native("patch", ["-R", ...appleArgs], { target: flow.next }, virtual.stdout, true);
        }
      }
      assert.equal(forward.exitCode, 0, `${forward.stderr}${forward.stdout}`);
      assert.equal(forward.target, flow.next, "independent native patch of virtual output");
      assert.equal(reverse.exitCode, 0, `${reverse.stderr}${reverse.stdout}`);
      assert.equal(reverse.target, flow.old, "independent native reverse of virtual output");
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
