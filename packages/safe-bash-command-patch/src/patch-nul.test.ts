import assert from "node:assert/strict";
import test from "node:test";
import { run, replacement } from "./helpers.test.js";

const cases = [
  { name: "untouched target bytes", old: "old\n\0\n", next: "new\n\0\n", patch: replacement },
  { name: "inserted NUL line", old: "old\n", next: "old\n\0\n", patch: "--- target\n+++ target\n@@ -1,0 +2 @@\n+\0\n" },
  { name: "NUL in context and changed lines", old: "a\0b\nold\0\n", next: "a\0b\nnew\0\n", patch: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n a\0b\n-old\0\n+new\0\n" },
  { name: "unterminated NUL line", old: "old\0", next: "new\0", patch: "--- target\n+++ target\n@@ -1 +1 @@\n-old\0\n\\ No newline at end of file\n+new\0\n\\ No newline at end of file\n" },
];

for (const example of cases) {
  for (const reverse of [false, true]) {
    test(`patch preserves ${example.name}${reverse ? " in reverse" : ""}`, async () => {
      const result = await run("patch", ["-f", ...(reverse ? ["-R"] : []), "target"], {
        files: { target: Buffer.from(reverse ? example.next : example.old) },
        input: Buffer.from(example.patch),
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await result.fs.readFile("/work/target"), new TextEncoder().encode(reverse ? example.old : example.next));
    });
  }
}

test("rejected hunks retain NUL bytes without changing the target", async () => {
  const patch = "--- target\n+++ target\n@@ -1 +1 @@\n-old\0\n+new\0\n";
  const result = await run("patch", ["-f", "--reject-format=unified", "target"], {
    files: { target: "different\0\n" }, input: Buffer.from(patch),
  });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.deepEqual(await result.fs.readFile("/work/target"), new TextEncoder().encode("different\0\n"));
  assert.deepEqual(await result.fs.readFile("/work/target.rej"), new TextEncoder().encode(patch));
});

test("named patch input and stdout preserve NUL bytes", async () => {
  const example = cases[2]!;
  const output: Uint8Array[] = [];
  const result = await run("patch", ["-f", "-i", "change.diff", "-o", "-", "target"], {
    files: { target: example.old, "change.diff": example.patch },
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.concat(output), Buffer.from(example.next));
  assert.deepEqual(await result.fs.readFile("/work/target"), new TextEncoder().encode(example.old));
});

test("NUL in a filename is still rejected", async () => {
  const result = await run("patch", ["-f"], {
    files: { target: "old\n" }, input: replacement.replaceAll("target", "tar\0get"),
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes("unsupported or empty patch filename"), result.stderr);
  assert.deepEqual(await result.fs.readFile("/work/target"), new TextEncoder().encode("old\n"));
});
