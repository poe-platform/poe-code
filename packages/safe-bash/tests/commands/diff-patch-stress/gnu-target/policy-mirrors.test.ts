import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "../../diff-patch/helpers.js";
import { instrument } from "../safety/helpers.js";

const section = (name: string, before = "old", after = "new") => `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
const flags = ["--batch", "--fuzz=0", "--no-backup-if-mismatch", "-p0"];
const fixtures = [
  { name: "same-file partial hunk publication and reject", files: { target: "old\nkeep\nend\n" },
    input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+NEW\n@@ -3 +3 @@\n-not-present\n+END\n",
    expected: { target: "NEW\nkeep\nend\n", "target.rej": "--- target\n+++ target\n@@ -3 +3 @@\n-not-present\n+END\n" } },
  { name: "multi-file continues after rejected file", files: { first: "old\n", second: "old\n", third: "old\n" },
    input: section("first") + section("second", "wrong") + section("third"),
    expected: { first: "new\n", second: "old\n", third: "new\n", "second.rej": section("second", "wrong") } },
] as const;

for (const fixture of fixtures) {
  test(`GNU default mirror: ${fixture.name}`, async () => {
    const result = await run("patch", flags, { files: fixture.files, input: fixture.input });
    const actual: Record<string, string> = {};
    for (const entry of await result.fs.readdir("/work")) {
      assert.equal(entry.type, "file");
      actual[entry.name] = await contents(result.fs, entry.name);
    }
    assert.equal(result.exitCode, 1, result.stderr);
    assert.deepEqual(actual, fixture.expected);
  });

  test(`atomic extension mirror: ${fixture.name} has no publication`, async () => {
    const fs = await filesystem(fixture.files);
    const observed = instrument(fs);
    const result = await run("patch", ["--atomic", ...flags], { fs: observed.fs, input: fixture.input });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(fixture.files).sort());
    for (const [name, before] of Object.entries(fixture.files)) assert.equal(await contents(fs, name), before);
  });
}

for (const atomic of [false, true]) {
  test(`${atomic ? "atomic extension" : "GNU default"} mirror: sequential sections publish ${atomic ? "one final write" : "each section"}`, async () => {
    const input = section("target", "old", "middle") + section("target", "middle", "final");
    const fs = await filesystem({ target: "old\n" });
    const observed = instrument(fs);
    const result = await run("patch", [...(atomic ? ["--atomic"] : []), ...flags], { fs: observed.fs, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "target"), "final\n");
    assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), Array.from({ length: atomic ? 1 : 2 }, () => ["writeFile", "/work/target"]));
  });
}
