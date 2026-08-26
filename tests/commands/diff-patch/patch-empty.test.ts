import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

const deletion = {
  normal: "1d0\n< old\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n- old\n--- 0 ----\n",
  unified: "--- target\n+++ target\n@@ -1 +0,0 @@\n-old\n",
};

for (const [format, input] of Object.entries(deletion)) for (const flag of ["-E", "--remove-empty-files"]) {
  test(`${format} ${flag} removes empty results but dry-run preserves existence`, async () => {
    const fs = await filesystem({ target: "old\n" });
    const dry = await run("patch", [flag, "--dry-run", "/work/target"], { fs, input });
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.equal(await contents(fs, "target"), "old\n");
    const forward = await run("patch", [flag, "/work/target"], { fs, input });
    assert.equal(forward.exitCode, 0, forward.stderr);
    await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
    const reverse = await run("patch", ["-R", flag, "/work/target"], { fs, input });
    assert.equal(reverse.exitCode, 0, reverse.stderr);
    assert.equal(await contents(fs, "target"), "old\n");
  });
}

for (const format of ["context", "unified"] as const) {
  const remove = format === "context" ? deletion[format].replace("--- target", "--- /dev/null")
    : deletion[format].replace("+++ target", "+++ /dev/null");
  const create = format === "context"
    ? "*** /dev/null\n--- target\n***************\n*** 0 ****\n--- 1 ----\n+ old\n"
    : "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+old\n";
  for (const [mode, input] of [[[], create], [["-R"], remove]] as const) for (const target of [[], ["/work/target"]]) {
    test(`${format} /dev/null ${mode.length ? "reverse" : "forward"} creation ${target.join(" ") || "auto"} accepts only missing or empty`, async () => {
      for (const initial of [undefined, "", "occupied\n"]) {
        const fs = await filesystem(initial === undefined ? {} : { target: initial });
        const dry = await run("patch", ["--dry-run", ...mode, ...target], { fs, input });
        assert.equal(dry.exitCode, initial ? 1 : 0, dry.stderr);
        if (initial === undefined) await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
        else assert.equal(await contents(fs, "target"), initial);
        const result = await run("patch", [...mode, ...target], { fs, input });
        assert.equal(result.exitCode, initial ? 1 : 0, result.stderr);
        assert.equal(await contents(fs, "target"), initial || "old\n");
      }
    });
  }
}

test("--atomic remove-empty stages recreation and preflights later conflicts", async () => {
  const create = "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n";
  const forward = await run("patch", ["--atomic", "-E", "target"], { files: { target: "old\n" }, input: deletion.normal + create });
  assert.equal(forward.exitCode, 0, forward.stderr);
  assert.equal(await contents(forward.fs, "target"), "new\n");
  const reverse = await run("patch", ["--atomic", "-RE", "target"], { fs: forward.fs, input: deletion.normal + create });
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(await contents(forward.fs, "target"), "old\n");
  const failed = await run("patch", ["--atomic", "-E", "target"], { files: { target: "old\n" },
    input: deletion.normal + "--- target\n+++ target\n@@ -1 +1 @@\n-wrong\n+new\n" });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stdout, "");
  assert.equal(await contents(failed.fs, "target"), "old\n");
});

test("existing-empty creation and remove-empty retain link guards", async () => {
  for (const link of ["symlink", "hardlink"]) {
    const fs = await filesystem({ original: "" });
    if (link === "symlink") await fs.symlink("/work/original", "/work/target");
    else await fs.link("/work/original", "/work/target");
    const result = await run("patch", ["-E", "target"], { fs,
      input: "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(fs, "original"), "");
  }
});
