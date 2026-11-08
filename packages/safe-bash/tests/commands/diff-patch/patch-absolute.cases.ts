import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../src/shell/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

test("exact comparator absolute-target integration uses virtual root", async () => {
  const fs = await filesystem();
  await fs.mkdir("/fixture");
  await fs.writeFile("/fixture/old", Buffer.from("a\nb\n"));
  await fs.writeFile("/fixture/new", Buffer.from("a\nc\n"));
  const shell = new Shell({ fs, cwd: "/fixture" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("diff -u --label old --label new old new > change; patch /fixture/old < change; cat old");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "patching file /fixture/old\na\nc\n");
});

for (const target of ["target", "/work/target", "/work//./target"]) {
  test(`authorized target ${target} allows absolute header labels without selecting them`, async () => {
    const fs = await filesystem({ target: "old\n", changes: replacement.replaceAll("target", "/unrelated/label") });
    for (const args of [["--dry-run"], [], ["-R"]]) {
      const result = await run("patch", [...args, "-p99", "-i", "/work/changes", target], { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(fs, "target"), args.length ? "old\n" : "new\n");
    }
    await assert.rejects(fs.stat("/unrelated"), { code: "ENOENT" });
  });
}

for (const path of ["/work/target", "/work/../target", "a/../../target", "a/C:target"]) {
  test(`header autoselection rejects ${path} before stripping`, async () => {
    const result = await run("patch", ["-p2"], { files: { target: "old\n" }, input: replacement.replaceAll("target", path) });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("explicit targets reject traversal before normalization", async () => {
  for (const args of [["/work/../work/target"], ["../work/target"]]) {
    const result = await run("patch", args, { files: { target: "old\n", changes: replacement }, input: replacement });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  }
  const result = await run("patch", ["/work/target"], { files: { target: "old\n" }, input: replacement.replaceAll("target", "/work/../work/target") });
  assert.equal(result.exitCode, 2);
});

test("authorized absolute target preserves dev-null creation and reverse deletion", async () => {
  const fs = await filesystem();
  const input = "--- /dev/null\n+++ /ignored/label\n@@ -0,0 +1 @@\n+new\n";
  assert.equal((await run("patch", ["--dry-run", "/work/target"], { fs, input })).exitCode, 0);
  await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
  assert.equal((await run("patch", ["/work/target"], { fs, input })).exitCode, 0);
  assert.equal(await contents(fs, "target"), "new\n");
  assert.equal((await run("patch", ["-R", "/work/target"], { fs, input })).exitCode, 0);
  await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
});

test("authorized target still rejects symlink, ancestor, hardlink and input aliases", async () => {
  const fs = await filesystem({ target: "old\n", changes: replacement });
  await fs.symlink("/work/target", "/work/link");
  await fs.symlink("/work", "/alias");
  await fs.link("/work/target", "/work/hard");
  await fs.symlink("/work/changes", "/work/input-link");
  for (const args of [["/work/link"], ["/alias/target"], ["/work/hard"], ["/work/target"], ["-i", "/work/input-link", "/work/target"]]) {
    assert.equal((await run("patch", args, { fs, input: replacement })).exitCode, 2);
  }
  assert.equal(await contents(fs, "target"), "old\n");
});
