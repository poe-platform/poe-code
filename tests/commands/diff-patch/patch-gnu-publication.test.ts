import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isFsError, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run, type Files } from "./helpers.js";
import { gnuPatch, nativeGNU } from "./patch-gnu-native.js";

const binaryHash = "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00";
const twoHunks = replacement + "@@ -3 +3 @@ function\n-tail\n+TAIL\n";
const normal = "Index: target\n1c1\n< old\n---\n> new\n3c3\n< tail\n---\n> TAIL\n";
const context = "*** target\t2020-01-01 00:00:00 +0000\n--- target\t2021-01-01 00:00:00 +0000\n*************** function\n*** 1 ****\n! old\n--- 1 ----\n! new\n*************** later\n*** 3 ****\n! tail\n--- 3 ----\n! TAIL\n";

async function namespace(fs: FileSystem) {
  const files: Record<string, string> = {};
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") { directories.push(path); await visit(path); }
      else if (entry.type === "file") files[path] = await contents(fs, path);
      else throw new Error(`unexpected entry ${path}`);
    }
  };
  let rootExists = true;
  try { await visit(""); }
  catch (error) { if (!isFsError(error, "ENOENT")) throw error; rootExists = false; }
  return { files, directories: directories.sort(), rootExists };
}

test("publication oracle is exactly the pinned GNU patch 2.8 binary", async () => {
  assert.equal(createHash("sha256").update(await readFile(gnuPatch)).digest("hex"), binaryHash);
  assert.match((await nativeGNU(["--version"])).stdout, /^GNU patch 2\.8\n/u);
});

interface Fixture { readonly name: string; readonly files: Files; readonly input: string; readonly args?: readonly string[] }
const fixtures: readonly Fixture[] = [
  { name: "unified partial succeeds then rejects", files: { target: "old\nkeep\nwrong\n" }, input: twoHunks },
  { name: "unified partial rejects then succeeds", files: { target: "wrong\nkeep\ntail\n" }, input: twoHunks },
  { name: "context partial retains timestamps and section labels", files: { target: "old\nkeep\nwrong\n" }, input: context },
  { name: "normal partial uses Index and context reject format", files: { target: "old\nkeep\nwrong\n" }, input: normal, args: ["-n"] },
  { name: "normal explicit target accepts bare diff preamble", files: { target: "wrong\n" }, input: "diff old new\n1c1\n< old\n---\n> new\n", args: ["target"] },
  { name: "bare diff preamble does not supply normal target", files: { target: "old\n" }, input: "diff target target\n1c1\n< old\n---\n> new\n" },
  { name: "explicit -n skips unlocated normal target", files: { target: "old\n" }, input: "diff target target\n1c1\n< old\n---\n> new\n", args: ["-n"] },
  { name: "unlocated normal section does not stop later indexed section", files: { target: "old\n" }, input: "1c1\n< old\n---\n> new\nIndex: target\n1c1\n< old\n---\n> new\n" },
  { name: "normal Index is stripped in rejects", files: { target: "wrong\n" }, input: normal.replace("Index: target", "Index: deep/target"), args: ["-p1", "-n"] },
  { name: "header names take precedence over Index", files: { target: "wrong\n", index: "old\n" }, input: `Index: index\n${replacement}` },
  { name: "existing reject is replaced", files: { target: "wrong\n", "target.rej": "stale\n" }, input: replacement },
  { name: "rejects append during one invocation", files: { target: "wrong\n", "target.rej": "stale\n" }, input: replacement + replacement.replace("-old", "-absent") },
  { name: "explicit reject file", files: { target: "wrong\n", rejects: "stale\n" }, input: replacement, args: ["-r", "rejects"] },
  { name: "long explicit reject file", files: { target: "wrong\n" }, input: replacement, args: ["--reject-file=rejects"] },
  { name: "discard rejects still creates mismatch backup", files: { target: "wrong\n" }, input: replacement, args: ["-r", "-"] },
  { name: "reject parent is not implicitly created", files: { target: "wrong\n" }, input: replacement, args: ["-r", "missing/rejects"] },
  { name: "no backup if mismatch", files: { target: "wrong\n", "target.orig": "retain\n" }, input: replacement, args: ["--no-backup-if-mismatch"] },
  { name: "default backup replaces existing orig", files: { target: "wrong\n", "target.orig": "stale\n" }, input: replacement },
  { name: "existing numbered backups select next version", files: { target: "wrong\n", "target.~1~": "one\n", "target.~4~": "four\n" }, input: replacement },
  { name: "clean first section suppresses later mismatch backup", files: { target: "old\n" }, input: replacement + replacement.replace("-old", "-absent").replace("+new", "+last") },
  { name: "clean target can coexist with later orig target", files: { target: "old\n", "target.orig": "old\n" }, input: replacement + replacement.replaceAll("target", "target.orig") },
  { name: "offset match produces orig backup", files: { target: "prefix\nold\n" }, input: replacement },
  { name: "default fuzz two produces orig backup", files: { target: "head\nold\ntail\n" }, input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n other\n-old\n+new\n end\n" },
  { name: "explicit fuzz zero rejects without narrowing default", files: { target: "head\nold\ntail\n" }, input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n other\n-old\n+new\n end\n", args: ["-F0"] },
  { name: "batch reverses previously applied patch", files: { target: "new\n" }, input: replacement },
  { name: "force does not reverse", files: { target: "new\n" }, input: replacement, args: ["--force"] },
  { name: "batch does not cancel force", files: { target: "new\n" }, input: replacement, args: ["-ft"] },
  { name: "last grouped format selector chooses unified", files: { target: "old\n" }, input: replacement, args: ["-cu"] },
  { name: "last grouped format selector rejects unified as context", files: { target: "old\n" }, input: replacement, args: ["-uc"] },
  { name: "last long format selector chooses unified", files: { target: "old\n" }, input: replacement, args: ["--normal", "--unified"] },
  { name: "reverse keeps section order", files: { target: "last\n" }, input: replacement + replacement.replace("-old", "-new").replace("+new", "+last"), args: ["-R"] },
  { name: "default dry-run reads unmodified filesystem", files: { target: "old\n" }, input: replacement + replacement.replace("-old", "-new").replace("+new", "+last"), args: ["--dry-run"] },
  { name: "dry-run leaves existing backup and reject", files: { target: "wrong\n", "target.orig": "backup\n", "target.rej": "reject\n" }, input: replacement, args: ["--dry-run"] },
  { name: "later missing target continues to third", files: { first: "old\n", third: "old\n" }, input: ["first", "second", "third"].map(name => replacement.replaceAll("target", name)).join("") },
  { name: "later malformed section retains completed prefix", files: { first: "old\n", second: "old\n" }, input: replacement.replaceAll("target", "first") + replacement.replaceAll("target", "second").replace("+new\n", "") },
  { name: "failed overlap permits a later matching hunk", files: { target: "old\nkeep\ntail\n" }, input: replacement + "@@ -3 +3 @@\n-absent\n+no\n@@ -3 +3 @@\n-tail\n+TAIL\n" },
  { name: "subsequent zero-range insertion has GNU coordinates", files: { target: "a\nb\nc\n" }, input: "--- target\n+++ target\n@@ -1 +1 @@\n-a\n+A\n@@ -1,0 +1 @@\n+new\n" },
  { name: "overlapping old range is a hunk conflict", files: { target: "a\nb\nc\n" }, input: "--- target\n+++ target\n@@ -1,2 +1,0 @@\n-a\n-b\n@@ -2 +1 @@\n-b\n+B\n" },
  { name: "overlapping new range is a hunk conflict", files: { target: "a\nb\nc\n" }, input: "--- target\n+++ target\n@@ -1,0 +1,2 @@\n+A\n+B\n@@ -1 +2 @@\n-a\n+C\n" },
  { name: "repeated old coordinates are a hunk conflict", files: { target: "old\n" }, input: replacement + "@@ -1 +1 @@\n-old\n+again\n" },
  { name: "reject coordinates track successful insertion", files: { target: "old\nkeep\nwrong\n" }, input: twoHunks.replace("@@ -1 +1 @@", "@@ -1 +1,2 @@").replace("+new\n", "+new\n+extra\n").replace("@@ -3 +3 @@", "@@ -3 +4 @@") },
  { name: "incomplete reject lines reproduce GNU bytes", files: { target: "wrong\n" }, input: replacement.replace("-old\n", "-old\n\\ No newline at end of file\n").replace("+new\n", "+new\n\\ No newline at end of file\n") },
  { name: "creation over nonempty file assumes reversal", files: { target: "wrong\n" }, input: "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n" },
  { name: "creation over nonempty file force retains forward reject", files: { target: "wrong\n" }, input: "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n", args: ["-f"] },
  { name: "deletion of missing target assumes creation", files: {}, input: "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n" },
  { name: "incomplete deletion publishes successful removal", files: { target: "old\nretained\n" }, input: "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n" },
  { name: "creation makes missing parents", files: {}, input: "--- /dev/null\n+++ tree/deep/target\n@@ -0,0 +1 @@\n+new\n", args: ["-p0"] },
];

for (const fixture of fixtures) test(`GNU publication: ${fixture.name}`, async () => {
  const args = ["--batch", ...fixture.args ?? []];
  const native = await nativeGNU(args, fixture.files, fixture.input);
  const actual = await run("patch", args, { files: fixture.files, input: fixture.input });
  assert.deepEqual({ exitCode: actual.exitCode, ...await namespace(actual.fs) },
    { exitCode: native.exitCode, files: native.files, directories: native.directories, rootExists: native.rootExists },
    `${fixture.name}\nproduct: ${actual.stdout}${actual.stderr}\nnative: ${native.stdout}${native.stderr}`);
});

for (const fixture of fixtures.filter(fixture => /coordinates|overlapping/u.test(fixture.name))) {
  test(`--atomic retains GNU coordinates and preflights conflicts: ${fixture.name}`, async () => {
    const native = await nativeGNU(["--batch"], fixture.files, fixture.input);
    const fs = await filesystem(fixture.files);
    const before = await namespace(fs);
    const result = await run("patch", ["--atomic", "--batch"], { fs, input: fixture.input });
    assert.equal(result.exitCode, native.exitCode);
    assert.deepEqual((await namespace(fs)).files, native.exitCode ? before.files : native.files);
  });
}

test("noninteractive default explicitly chooses batch reversal, not force", async () => {
  const expected = await nativeGNU(["--batch"], { target: "new\n" }, replacement);
  const actual = await run("patch", [], { files: { target: "new\n" }, input: replacement });
  assert.equal(actual.exitCode, expected.exitCode);
  assert.deepEqual((await namespace(actual.fs)).files, expected.files);
  assert.match(actual.stdout, /Assuming -R/u);
});

test("reject replacement resets across invocations", async () => {
  const fs = await filesystem({ target: "wrong\n", "target.rej": "stale\n" });
  for (const input of [replacement, replacement.replace("-old", "-absent")]) {
    const initial = (await namespace(fs)).files;
    const expected = await nativeGNU(["--batch"], initial, input);
    const actual = await run("patch", ["--batch"], { fs, input });
    assert.equal(actual.exitCode, expected.exitCode);
    assert.deepEqual((await namespace(fs)).files, expected.files);
  }
});

for (const input of [twoHunks, replacement + replacement.replaceAll("target", "missing"), replacement + "--- missing\n+++ missing\n@@ -1 +1 @@\n-old\n"]) {
  test(`--atomic paired control retains complete namespace: ${JSON.stringify(input)}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", "target.orig": "existing backup\n", "target.rej": "existing reject\n" });
    const before = await namespace(fs);
    const actual = await run("patch", ["--atomic"], { fs, input });
    assert.notEqual(actual.exitCode, 0);
    assert.deepEqual(await namespace(fs), before);
  });
}

for (const atomic of [false, true]) for (const suffix of [".orig", ".rej"]) for (const kind of ["symlink", "hardlink"]) {
  test(`publication safety ${atomic ? "atomic" : "default"}: ${suffix} ${kind}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", protected: "PROTECTED\n" });
    if (kind === "symlink") await fs.symlink("protected", `/work/target${suffix}`);
    else await fs.link("/work/protected", `/work/target${suffix}`);
    const result = await run("patch", atomic ? ["--atomic"] : [], { fs, input: twoHunks });
    assert.notEqual(result.exitCode, 0);
    assert.equal(await contents(fs, "protected"), "PROTECTED\n");
    assert.equal(await contents(fs, "target"), "old\nkeep\nwrong\n");
  });
}
