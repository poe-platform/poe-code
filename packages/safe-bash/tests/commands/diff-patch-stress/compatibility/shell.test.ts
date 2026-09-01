import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./fixtures.js";
import { expectedFiles, shell, snapshot } from "./helpers.js";

test("Shell+Memory literal stdin accepts POSIX blank context", async () => {
  const fixture = cases[0]!;
  const workspace = await shell(fixture.files);
  const result = await workspace.shell.exec("patch -u -F0", { stdin: fixture.patch, signal: AbortSignal.timeout(5000) });
  assert.deepEqual({ status: result.exitCode, files: await snapshot(workspace.fs, ["target"]) }, { status: 0, files: expectedFiles(fixture.expected) }, result.stderr);
});

test("Shell+Memory dry-run and apply preserve cwd, stripped paths, reverse bytes", async () => {
  const input = "--- a/target\n+++ b/target\n@@ -1,2 +1,3 @@\n head\n-old\n\\ No newline at end of file\n+new\n+tail\n\\ No newline at end of file\n";
  const workspace = await shell({ "tree/target": "head\nold", changes: input });
  const dry = await workspace.shell.exec("(cd tree && patch --dry-run -p1 -i ../changes) >check.log", { signal: AbortSignal.timeout(5000) });
  assert.equal(dry.exitCode, 0, dry.stderr);
  assert.deepEqual(await snapshot(workspace.fs, ["tree/target"]), expectedFiles({ "tree/target": "head\nold" }));
  const forward = await workspace.shell.exec("(cd tree && patch -p1 -i ../changes) >apply.log", { signal: AbortSignal.timeout(5000) });
  assert.equal(forward.exitCode, 0, forward.stderr);
  assert.deepEqual(await snapshot(workspace.fs, ["tree/target"]), expectedFiles({ "tree/target": "head\nnew\ntail" }));
  const reverse = await workspace.shell.exec("(cd tree && patch -Rp1 --input ../changes) >reverse.log", { signal: AbortSignal.timeout(5000) });
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.deepEqual(await snapshot(workspace.fs, ["tree/target"]), expectedFiles({ "tree/target": "head\nold" }));
});

test("Shell+Memory multi-hunk pipeline preserves expected target bytes", async () => {
  const files = { left: "start\na\nb\nc\nd\ne\nf\ng\n", right: "start\nA\nb\nc\nd\ne\nf\nG\n", target: "prefix\nstart\na\nb\nc\nd\ne\nf\ng\n" };
  const workspace = await shell(files);
  const result = await workspace.shell.exec("diff -U1 -L target -L target left right | patch -F0 >apply.log", { signal: AbortSignal.timeout(5000) });
  const expected = expectedFiles({ target: "prefix\nstart\nA\nb\nc\nd\ne\nf\nG\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await snapshot(workspace.fs, ["target"]), expected);

});

test("Shell+Memory repeated format options retain GNU maximum context", async () => {
  const workspace = await shell({ left: "old\ncontext\n", right: "new\ncontext\n" });
  const result = await workspace.shell.exec("diff -U0 -u -L target -L target left right >changes", { signal: AbortSignal.timeout(5000) });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.deepEqual(await snapshot(workspace.fs, ["changes"]), expectedFiles({ changes: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n" }));
});
