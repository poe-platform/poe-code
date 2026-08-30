import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, native, replacement, run } from "./helpers.js";

const first = replacement.replaceAll("target", "first");
const metadata = [
  "rename from target", "rename to sentinel", "copy from target", "copy to sentinel",
  "new file mode 120000", "deleted file mode 120000", "old mode 120000", "new mode 120000",
  "similarity index 100%", "dissimilarity index 100%", "GIT binary patch", "unknown extension metadata",
];

for (const line of metadata) {
  test(`followup GNU ignores bare interstitial ${line}`, async () => {
    const input = first + `${line}\n` + replacement;
    const files = { first: "old\n", target: "old\n", sentinel: "untouched\n" };
    const expected = await native("patch", ["--batch"], files, input);
    assert.equal(expected.exitCode, 0, expected.stderr);
    for (const args of [[], ["--atomic"]]) {
      const actual = await run("patch", args, { files, input });
      assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(await contents(actual.fs, "first"), "new\n");
      assert.equal(await contents(actual.fs, "target"), "new\n");
      assert.equal(await contents(actual.fs, "sentinel"), "untouched\n");
      assert.equal((await actual.fs.lstat("/work/target")).type, "file");
    }
  });
}

for (const kind of ["traversal", "symlink", "hardlink"] as const) {
  test(`followup scan authorizes selected ${kind} tail before any status or writes`, async () => {
    const fs = await filesystem({ first: "old\n", target: "old\n" });
    if (kind === "symlink") await fs.symlink("target", "/work/alias");
    if (kind === "hardlink") await fs.link("/work/target", "/work/alias");
    const tail = replacement.replaceAll("target", kind === "traversal" ? "../outside" : "alias");
    const result = await run("patch", [], { fs, input: first + "rename from target\n" + tail });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(await contents(fs, "first"), "old\n");
    assert.equal(await contents(fs, "target"), "old\n");
  });
}

test("followup bare metadata scanning does not implement Git rename envelopes", async () => {
  const result = await run("patch", ["--atomic"], {
    files: { first: "old\n", target: "old\n" },
    input: first + "diff --git a/target b/target\nrename from target\nrename to renamed\n" + replacement,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "first"), "old\n");
  assert.equal(await contents(result.fs, "target"), "old\n");
});
