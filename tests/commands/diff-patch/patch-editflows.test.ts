import assert from "node:assert/strict";
import test from "node:test";
import { contents, replacement, run } from "./helpers.js";

for (const [name, encoded] of [
  ["file name", "file name"], ['a"quote', 'a\\"quote'], ["café", "caf\\303\\251"],
  ["tab\tname", "tab\\tname"], ["literal\ttab", "literal\ttab"],
]) test(`strict quoted filename roundtrip ${JSON.stringify(name)}`, async () => {
  const input = replacement.replace("--- target", `--- "a/${encoded}"`).replace("+++ target", `+++ "b/${encoded}"`);
  const result = await run("patch", ["-p1"], { files: { [name!]: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, name!), "new\n");
  assert.equal((await run("patch", ["-Rp1"], { fs: result.fs, input })).exitCode, 0);
  assert.equal(await contents(result.fs, name!), "old\n");
});

for (const encoded of ["\\q", "\\400", "\\777", "\\12", "\\300\\257", "\\377", "\\000", "\\n", "\\r", "\\057tmp", "a/\\056\\056/target", "a/C:target", "a/\\\\target"]) {
  test(`decoded unsafe filename rejected before stripping ${encoded}`, async () => {
    const input = replacement + replacement.replaceAll("target", `"${encoded}"`);
    const result = await run("patch", [], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("relative repeated separators collapse before stripping; traversal never does", async () => {
  const result = await run("patch", ["-p1"], { files: { target: "old\n" }, input: replacement.replaceAll("target", "a//target") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  const unsafe = await run("patch", ["-p2"], { files: { target: "old\n" }, input: replacement.replaceAll("target", "a//../target") });
  assert.equal(unsafe.exitCode, 2);
  assert.equal(await contents(unsafe.fs, "target"), "old\n");
});
