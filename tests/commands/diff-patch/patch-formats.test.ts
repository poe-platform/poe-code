import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, replacement, run } from "./helpers.js";

const fixtures = [
  { format: "unified", flag: "-u", input: replacement },
  { format: "normal", flag: "-n", input: "1c1\n< old\n---\n> new\n" },
  { format: "context", flag: "-c", input: "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n" },
] as const;

for (const fixture of fixtures) for (const target of ["target", "/work/target"]) {
  for (const selector of [[], [fixture.flag], [`--${fixture.format}`]]) {
    test(`${fixture.format} ${selector.join(" ") || "autodetect"} with ${target} dry-run/forward/reverse`, async () => {
      const fs = await filesystem({ target: "old\n", changes: fixture.input });
      for (const mode of [["--dry-run"], [], ["--reverse"]]) {
        const result = await run("patch", [...selector, ...mode, "--input=/work/changes", target], { fs });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(await contents(fs, "target"), mode.length ? "old\n" : "new\n");
      }
    });
  }
  for (const wrong of fixtures.filter(other => other !== fixture)) {
    test(`${fixture.format} rejects asserted ${wrong.format} before writing ${target}`, async () => {
      const result = await run("patch", [wrong.flag, target], { files: { target: "old\n" }, input: fixture.input });
      assert.equal(result.exitCode, 2);
      assert.equal(await contents(result.fs, "target"), "old\n");
    });
  }
}

for (const fixture of fixtures) {
  test(`${fixture.format} rejects truncated final physical line`, async () => {
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input: fixture.input.slice(0, -1) });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
  for (const options of [{ maxHunks: 1 }, { maxWork: 3 }, { maxLines: 3 }, { maxOutputBytes: 2 }]) {
    test(`${fixture.format} budget ${JSON.stringify(options)} causes zero early writes`, async () => {
      const input = fixture.format === "normal" ? `${fixture.input}2c2\n< old\n---\n> new\n`
        : fixture.format === "unified" ? `${fixture.input}@@ -2 +2 @@\n-old\n+new\n`
        : `${fixture.input}***************\n*** 2 ****\n! old\n--- 2 ----\n! new\n`;
      const result = await run("patch", ["target"], { files: { target: "old\nold\n" }, input, options });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(await contents(result.fs, "target"), "old\nold\n");
    });
  }
}

for (const input of [
  "0c1\n< old\n---\n> new\n", "1,0c1\n< old\n---\n> new\n", "1,2a1\n> new\n",
  "1c1\n< old\n---\n", "1c1\n< old\n---\n> new\n> extra\n", "9007199254740992c1\n",
  "*** target\n--- target\n***************\n*** 1,2 ****\n! old\n--- 1 ----\n! new\n",
  "*** target\n--- target\n***************\n*** 1 ****\n  old\n--- 1 ----\n  other\n",
  "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n+ new\n",
]) {
  test(`--atomic malformed format never publishes ${JSON.stringify(input)}`, async () => {
    const result = await run("patch", ["--atomic", "target"], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("normal autodetection requires a target and explicit target preserves EOF", async () => {
  const input = "1c1\n< old\n\\ No newline at end of file\n---\n> new\n\\ No newline at end of file\n";
  assert.equal((await run("patch", [], { files: { target: "old" }, input })).exitCode, 2);
  const result = await run("patch", ["/work/target"], { files: { target: "old" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new");
});

test("context format validates header traversal and permits authorized absolute labels", async () => {
  const input = fixtures[2].input.replaceAll("target", "/ignored/label");
  assert.equal((await run("patch", [], { files: { target: "old\n" }, input })).exitCode, 2);
  const result = await run("patch", ["/work/target"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  assert.equal((await run("patch", ["target"], { files: { target: "old\n" }, input: input.replaceAll("/ignored/label", "a/../label") })).exitCode, 2);
});
