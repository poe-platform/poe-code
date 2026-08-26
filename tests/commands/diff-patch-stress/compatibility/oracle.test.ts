import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { expectedFiles, native } from "./helpers.js";
import { oracleIdentity } from "./oracle.js";

const controls = [
  { name: "interior deletion", before: "a\nb\nc\n", after: "a\nc\n", width: 0,
    delta: "--- target\n+++ target\n@@ -2 +1,0 @@\n-b\n", appleReverse: { status: 0, target: "b\na\nc\n" } },
  { name: "empty deletion", before: "a\n", after: "", width: 0,
    delta: "--- target\n+++ target\n@@ -1 +0,0 @@\n-a\n", appleReverse: { status: 1, target: "" } },
  { name: "unterminated context", before: "a\nz", after: "b\nz", width: 1,
    delta: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n-a\n+b\n z\n\\ No newline at end of file\n", appleReverse: { status: 1, target: "b\nz" } },
] as const;

for (const fixture of controls) test(`native-self calibration, not product acceptance: ${fixture.name}`, async context => {
  const diff = oracleIdentity("diff");
  const patch = oracleIdentity("patch");
  const generated = await native("diff", [`-U${fixture.width}`, "-L", "target", "-L", "target", "old", "next"], { old: fixture.before, next: fixture.after });
  assert.equal(generated.exitCode, 1);
  assert.equal(generated.stdout.toString(), fixture.delta);
  for (const reverse of [false, true]) {
    const result = await native("patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : [])], { target: reverse ? fixture.after : fixture.before }, generated.stdout.toString());
    const expected = reverse && patch.dialect === "apple-patch-2.0-12u11" ? fixture.appleReverse
      : { status: 0, target: reverse ? fixture.before : fixture.after };
    context.diagnostic(JSON.stringify({ name: fixture.name, diff, patch, reverse, rawStatus: result.exitCode, rawFiles: result.files, canonicalTarget: reverse ? fixture.before : fixture.after }));
    assert.deepEqual({ status: result.exitCode, files: result.files }, { status: expected.status, files: expectedFiles({ target: expected.target }) });
  }
});

for (const value of ["", "patch", "/nonexistent/virtual-bash-oracle/patch"]) test(`explicit oracle configuration fails closed: ${JSON.stringify(value)}`, () => {
  const script = `import { oracleIdentity } from ${JSON.stringify(new URL("./oracle.ts", import.meta.url).href)}; oracleIdentity("patch");`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    env: { ...process.env, DIFF_PATCH_NATIVE_PATCH: value }, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.match(result.stderr, value.startsWith("/") ? /ENOENT/u : /must be a nonempty absolute executable path/u);
});
