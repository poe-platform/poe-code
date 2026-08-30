import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { native, replacement } from "./helpers.js";

const deletion = "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";

for (const absolute of [false, true]) {
  test(`native GNU deletion ${absolute ? "prunes absolute-target" : "retains relative-target"} cwd`, async () => {
    const parent = await mkdtemp(join(process.cwd(), "tests/commands/diff-patch/native-helper-"));
    try {
      const sentinel = join(parent, "caller-sentinel");
      await writeFile(sentinel, "caller-owned\n", { flag: "wx" });
      const result = await native("patch", root => ["-p0", absolute ? join(root, "target") : "target"],
        { target: "old\n" }, deletion, { parent });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.rootExists, !absolute);
      assert.deepEqual(result.files, {});
      assert.deepEqual(result.directories, []);
      assert.equal(await readFile(sentinel, "utf8"), "caller-owned\n");
      assert.deepEqual(await readdir(parent), ["caller-sentinel"]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

test("native diff preserves the legacy argv, output, status, and file snapshot", async () => {
  const files = { old: "old\n", "nested/new": "new\n" };
  const result = await native("diff", ["-u", "--label", "target", "--label", "target", "old", "nested/new"], files);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, replacement);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.files, files);
  assert.deepEqual(result.directories, ["nested"]);
  assert.equal(result.rootExists, true);
});

test("native patch preserves the legacy input and successful file snapshot", async () => {
  const result = await native("patch", ["-p0"], { target: "old\n", "nested/kept": "kept\n" }, replacement);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "patching file target\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(result.files, { target: "new\n", "nested/kept": "kept\n" });
  assert.deepEqual(result.directories, ["nested"]);
  assert.equal(result.rootExists, true);
});

test("native argv keeps shell syntax and root-like tokens literal", async () => {
  const name = "$ROOT;$(not-a-command)";
  const files = { [name]: "same\n", other: "same\n" };
  const result = await native("diff", ["--", name, "other"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(result.files, files);
  assert.deepEqual(result.directories, []);
  assert.equal(result.rootExists, true);
});
