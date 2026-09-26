import assert from "node:assert/strict";
import test from "node:test";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { run, replacement } from "./helpers.js";

test("diff alignment charges integer comparisons and avoids excessive host turns", async () => {
  const signal = new AbortController().signal;
  let turns = 0;
  registerYieldCheckpoint(signal, () => { turns++; });
  const files = Object.fromEntries(["left", "right"].map(name => [name,
    Array.from({ length: 200 }, (_, index) => `${name}:${index}:` + "x".repeat(80) + "\n").join("")]));
  const result = await run("diff", ["left", "right"], { files, signal, options: { maxWork: 150_000 } });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok(turns <= 10, `${turns} host turns`);
  assert.ok(result.stdout.includes("1,200c1,200"));
});

test("brief diff avoids matrix allocation unless ignored hunks require alignment", async () => {
  for (const args of [["-q"], ["-q", "-i"]]) {
    const result = await run("diff", [...args, "left", "right"], {
      files: { left: "a\nb\n", right: "c\nd\n" }, options: { maxMatrixCells: 1 },
    });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "Files left and right differ\n");
  }
  const ignored = await run("diff", ["-q", "-I", "^ignore", "left", "right"], {
    files: { left: "ignore a\n", right: "ignore b\n" },
  });
  assert.equal(ignored.exitCode, 0, ignored.stderr);
});

test("all diff/patch quotas accept explicit Infinity", async () => {
  const options = { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxLines: Infinity,
    maxWork: Infinity, maxMatrixCells: Infinity, maxFiles: Infinity, maxHunks: Infinity,
    maxExcludePatterns: Infinity, maxExcludePatternBytes: Infinity };
  const diff = await run("diff", ["left", "right"], { options, files: { left: "a\n", right: "b\n" } });
  assert.equal(diff.exitCode, 1, diff.stderr);
  const patch = await run("patch", [], { options, files: { target: "old\n" }, input: replacement });
  assert.equal(patch.exitCode, 0, patch.stderr);
});

test("ed preserves scripts and diagnoses each incomplete input, including unchanged final lines", async () => {
  for (const [left, right, stdout] of [
    ["a\nb", "a\nc", "2c\nc\n.\n"],
    ["old1\nsame\nno-nl", "new1\nsame\nno-nl", "1c\nnew1\n.\n"],
    ["a", "a", ""],
    ["a\n", "a", ""],
    ["a\n", ".", "1c\n..\n.\ns/.//\n"],
  ]) {
    const result = await run("diff", ["-e", "left", "right"], { files: { left: left!, right: right! } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, [!left!.endsWith("\n") ? "diff: left: No newline at end of file\n\n" : "",
      !right!.endsWith("\n") ? "diff: right: No newline at end of file\n\n" : ""].join(""));
  }
});

test("ed newline diagnostics preserve binary comparisons unless text mode is requested", async () => {
  for (const right of ["a\0", "b\0"]) {
    const result = await run("diff", ["-e", "left", "right"], { files: { left: "a\0", right } });
    assert.equal(result.exitCode, right === "a\0" ? 0 : 1);
    assert.equal(result.stdout, right === "a\0" ? "" : "Binary files left and right differ\n");
    assert.equal(result.stderr, "");
  }
  const text = await run("diff", ["-ae", "left", "right"], { files: { left: "a\0", right: "b\0" } });
  assert.equal(text.exitCode, 2);
  assert.equal(text.stdout, "1c\nb\0\n.\n");
  assert.equal(text.stderr, "diff: left: No newline at end of file\n\ndiff: right: No newline at end of file\n\n");
});
