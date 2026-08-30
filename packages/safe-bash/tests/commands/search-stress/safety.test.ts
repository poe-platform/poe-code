import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { bounded, directory, native, text, virtual, type Probe } from "./harness.js";

test("isolated cancellation and iterator lifecycle checks", () => {
  const result = bounded(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", join(directory, "safety-cases.ts")], "", directory, 5000);
  assert.equal(result.code, 0, text(result.stdout) + text(result.stderr));
  assert.match(text(result.stdout), /# pass 10\b/u);
});

for (const maximum of [1, 2, 3, 4, 5, 6, 7, 8, 9]) test(`UTF8 output quota ${maximum} counts bytes atomically`, () => {
  const result = virtual([{ name: "quota", args: ["é", "-"], stdin: "é\né\né\n", options: { maxOutputBytes: maximum } }])[0]!;
  assert.equal(Buffer.from(result.stdout, "base64").length, Math.min(3, Math.floor(maximum / 3)) * 3);
  assert.equal(result.code, maximum < 9 ? 2 : 0);
  if (maximum < 9) assert.match(text(result.stderr), /output byte limit/u);
});

for (const [name, options, input, code] of [
  ["line exact", { maxLineBytes: 3 }, "foo\n", 0],
  ["line exceeded", { maxLineBytes: 2 }, "foo\n", 2],
  ["input exact", { maxFileBytes: 4 }, "foo\n", 0],
  ["input exceeded", { maxFileBytes: 3 }, "foo\n", 2],
] as const) test(name, () => {
  const result = virtual([{ name, args: ["foo", "-"], stdin: input, options, chunkSize: 1 }])[0]!;
  assert.equal(result.code, code, text(result.stderr));
});

for (const pattern of ["(?i)foo", "\\p{Greek}", "[[:alpha:]]"]) test(`documented Rust regex difference ${pattern}`, () => {
  const probe: Probe = { name: pattern, args: [pattern, "-"], stdin: "FOO α foo\n" };
  assert.equal(native(probe).code, 0);
  const result = virtual([probe])[0]!;
  assert.equal(result.code, 2);
  assert.match(text(result.stderr), /invalid or unsupported regular expression/u);
});

test("external deadline bounds a catastrophic JavaScript regex probe", () => {
  const probe: Probe = { name: "known non-preemptible regex", args: ["(a+)+$", "-"], stdin: "a".repeat(32) + "!\n" };
  assert.equal(native(probe).code, 1);
  assert.throws(() => bounded(process.execPath, ["--import", "tsx", join(directory, "worker.ts")], JSON.stringify([probe]), directory, 1000), /ETIMEDOUT/u);
});

test("empty matches on malformed bytes still enforce the match-count bound", () => {
  const result = virtual([{ name: "match limit", args: ["-o", "", "-"], stdin: Array<number>(100010).fill(255) }])[0]!;
  assert.equal(result.code, 2);
  assert.equal(text(result.stdout), "");
  assert.match(text(result.stderr), /matches per line limit/u);
});
