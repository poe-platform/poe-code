import assert from "node:assert/strict";
import test from "node:test";
import { filesystem, run } from "./helpers.js";

for (const suffix of ["/", "///"]) {
  for (const flags of [["-r"], ["-ru"], ["-rc"]]) {
    test(`directory trailing slashes: ${flags.join(" ")} ${suffix}`, async () => {
      const files = { "left/f": "old\n", "right/f": "new\n", "left/only": "unique\n" };
      const expected = await run("diff", [...flags, "left", "right"], { files });
      const actual = await run("diff", [...flags, `left${suffix}`, `right${suffix}`], { files });
      assert.equal(actual.exitCode, 1);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, expected.stdout);
      assert.ok(actual.stdout.includes("Only in left: only\n"));
    });
  }
  test(`common subdirectories with trailing ${suffix}`, async () => {
    const actual = await run("diff", [`left${suffix}`, `right${suffix}`], {
      files: { "left/sub/f": "old", "right/sub/f": "new" },
    });
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, "Common subdirectories: left/sub and right/sub\n");
  });
  for (const directoryFirst of [true, false]) {
    test(`directory/file matching with trailing ${suffix}, directory first ${directoryFirst}`, async () => {
      const files = { f: "new\n", "dir/f": "old\n" };
      const operands = directoryFirst ? ["dir", "f"] : ["f", "dir"];
      const expected = await run("diff", ["-u", ...operands], { files });
      const actual = await run("diff", ["-u", ...operands.map(path => path === "dir" ? path + suffix : path)], { files });
      assert.equal(actual.exitCode, 1);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, expected.stdout);
    });
  }
}

test("root directory child paths and Only in headers retain one slash", async () => {
  const fs = await filesystem({ f: "new\n" });
  await fs.writeFile("/f", Buffer.from("old\n"));
  const matched = await run("diff", ["-u", "/", "f"], { fs });
  assert.equal(matched.exitCode, 1);
  assert.equal(matched.stderr, "");
  assert.ok(matched.stdout.startsWith("--- /f\n+++ f\n"));
  const directories = await run("diff", ["/", "/work/"], { fs });
  assert.equal(directories.exitCode, 1);
  assert.equal(directories.stderr, "");
  assert.equal(directories.stdout, "diff /f /work/f\n1c1\n< old\n---\n> new\nOnly in /: work\n");
});
