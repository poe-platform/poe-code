import assert from "node:assert/strict";
import test, { before } from "node:test";
import { contents, labels, native, patchArgs, run, verifyOracles } from "./helpers.js";

before(async () => { console.log("FORMAT_ORACLES", JSON.stringify(await verifyOracles())); });

test("GNU selector regression: -C0 followed by -c resets to three lines", async () => {
  const files = { old: "a\nb\nc\n", new: "a\nB\nc\n" };
  const args = ["-C0", "-c", ...labels, "old", "new"];
  const expected = "*** target\n--- target\n***************\n*** 1,3 ****\n  a\n! b\n  c\n--- 1,3 ----\n  a\n! B\n  c\n";
  const gnu = await native("diff", args, files);
  const apple = await native("diff", args, files, "", true);
  assert.equal(gnu.stdout, expected);
  assert.notEqual(apple.stdout, expected);
  console.log("DIALECT_CONTROL", JSON.stringify({ case: "C0-c-order", gnu: gnu.stdout, apple: apple.stdout }));
  const result = await run("diff", args, { files });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, expected, "GNU profile gate; Apple-compatible current behavior is a dialect divergence, not universal invalidity");
});

test("empty native diff is a successful explicit-target patch no-op", async () => {
  const control = await native("patch", patchArgs, { target: "" }, "");
  assert.equal(control.exitCode, 0);
  assert.equal(control.target, "");
  const result = await run("patch", ["target"], { files: { target: "" }, input: "" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs), "");
});

test("normal replacement with incomplete final lines applies independent static input", async () => {
  const patch = "1c1\n< old\n\\ No newline at end of file\n---\n> new\n\\ No newline at end of file\n";
  const control = await native("patch", patchArgs, { target: "old" }, patch);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(control.target, "new");
  const result = await run("patch", ["target"], { files: { target: "old" }, input: patch });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs), "new");
});
