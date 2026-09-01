import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

const currentDate = "2026-08-26 00:00:00 +0000";
const epochDates = [
  "1970-01-01 00:00:00 +0000", "1970-01-01 00:00:00.000000000 +0000",
  "1969-12-31 19:00:00 -0500", "1970-01-01 01:00:00 +01:00", "Thu Jan  1 00:00:00 1970",
  "1970-01-01 00:00:00", "1970-01-01 00:00:00.900000000 +0000", "1970-01-01 00:00:01 +0000",
];

function creation(format: string, date: string, name = "target"): string {
  return format === "unified"
    ? `--- ${name}\t${date}\n+++ ${name}\t${currentDate}\n@@ -0,0 +1 @@\n+new\n`
    : `*** ${name}\t${date}\n--- ${name}\t${currentDate}\n***************\n*** 0 ****\n--- 1 ----\n+ new\n`;
}

for (const format of ["unified", "context"]) for (const date of epochDates) {
  for (const target of [[], ["/work/target"]]) {
    test(`${format} epoch ${date} ${target.join(" ") || "autoselect"} creates and reverses deletion`, async () => {
      const fs = await filesystem();
      const input = creation(format, date);
      assert.equal((await run("patch", ["--dry-run", ...target], { fs, input })).exitCode, 0);
      await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
      const forward = await run("patch", target, { fs, input });
      assert.equal(forward.exitCode, 0, forward.stderr);
      assert.equal(await contents(fs, "target"), "new\n");
      assert.equal((await run("patch", ["-R", "--dry-run", ...target], { fs, input })).exitCode, 0);
      assert.equal(await contents(fs, "target"), "new\n");
      const reverse = await run("patch", ["-R", ...target], { fs, input });
      assert.equal(reverse.exitCode, 0, reverse.stderr);
      await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
    });
  }
}

for (const date of [currentDate, "1970-01-02 02:00:00 +0000", "1969-12-30 23:00:00 +0000", "1970-02-30 00:00:00 +0000", "invalid timestamp"]) {
  test(`non-epoch ${date} leaves an empty regular file on reversal`, async () => {
    const result = await run("patch", ["-R"], { files: { target: "new\n" }, input: creation("unified", date) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "");
  });
}

for (const format of ["unified", "context"]) {
  test(`${format} epoch allows existing empty target but never overwrites nonempty data`, async () => {
    for (const original of ["", "existing\n"]) {
      const result = await run("patch", [], { files: { target: original }, input: creation(format, epochDates[0]!) });
      assert.equal(result.exitCode, original ? 1 : 0, result.stderr);
      assert.equal(await contents(result.fs, "target"), original || "new\n");
    }
  });
  test(`${format} epoch does not bypass header path validation`, async () => {
    const result = await run("patch", ["/work/target", "-p2"], { input: creation(format, epochDates[0]!, "a/../target") });
    assert.equal(result.exitCode, 2);
    await assert.rejects(result.fs.stat("/work/target"), { code: "ENOENT" });
  });
}

test("epoch timestamp on a nonempty side is not a creation or deletion directive", async () => {
  const input = `--- target\t${epochDates[0]}\n+++ target\t${epochDates[0]}\n@@ -1 +1 @@\n-old\n+new\n`;
  const result = await run("patch", [], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

test("normal zero-origin insertion can create a missing authorized target", async () => {
  const result = await run("patch", ["/work/target"], { input: "0a1\n> new\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

test("--atomic epoch create/delete sequence and later conflict preserve namespace", async () => {
  const create = creation("unified", epochDates[0]!);
  const remove = `--- target\t${currentDate}\n+++ target\t${epochDates[0]}\n@@ -1 +0,0 @@\n-new\n`;
  const fs = await filesystem();
  const result = await run("patch", ["--atomic"], { fs, input: create + remove });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "patching file target\npatching file target\n");
  await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
  const failed = await run("patch", ["--atomic"], { fs, input: create + remove.replace("-new\n", "-wrong\n") });
  assert.equal(failed.exitCode, 1);
  await assert.rejects(fs.stat("/work/target"), { code: "ENOENT" });
});
