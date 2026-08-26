import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

for (const fuzz of [0, 1]) test(`native asymmetric boundary fuzz calibration F${fuzz}`, async context => {
  const identity = oracleIdentity("patch");
  const input = "--- target\n+++ target\n@@ -1,2 +1,2 @@\n-old\n+new\n expected\n";
  const result = await native("patch", ["-f", "-p0", `-F${fuzz}`], { target: "old\nactual\n" }, input);
  const succeeds = fuzz === 1 && identity.dialect !== "apple-patch-2.0-12u11";
  context.diagnostic(JSON.stringify({ identity, fuzz, rawStatus: result.exitCode, rawFiles: result.files }));
  assert.deepEqual({ status: result.exitCode, files: result.files }, { status: succeeds ? 0 : 1, files: expectedFiles({ target: succeeds ? "new\nactual\n" : "old\nactual\n" }) });
});

test("native repeated-context options match independently captured dialect bytes", async context => {
  const bytes = await readFile(new URL("./flag-evidence.json", import.meta.url));
  const evidence = JSON.parse(bytes.toString()) as {
    files: Record<string, string>;
    records: { identity: { dialect: string }; args: string[]; exitCode: number; stdout: string; stderr: string }[];
  };
  const identity = oracleIdentity("diff");
  const records = evidence.records.filter(record => record.identity.dialect === identity.dialect);
  assert.equal(records.length, 6, `No pinned repeated-context evidence for ${JSON.stringify(identity)}`);
  context.diagnostic(`FLAG_EVIDENCE_SHA256 ${createHash("sha256").update(bytes).digest("hex")}`);
  for (const record of records) {
    const result = await native("diff", record.args, evidence.files);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() },
      { status: record.exitCode, stdout: record.stdout, stderr: record.stderr });
  }
});
