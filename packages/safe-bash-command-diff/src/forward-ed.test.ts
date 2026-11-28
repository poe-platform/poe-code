import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.test-support.js";
import { evalSyncDiff } from "./sync.js";

const cases = [
  { name: "reported replacement and append", old: "a\nb\nc\n", next: "a\nX\nc\nd\n", stdout: "c2\nX\n.\na3\nd\n.\n" },
  { name: "change range", old: "a\nb\nc\nd\n", next: "a\nB\nC\nd\n", stdout: "c2 3\nB\nC\n.\n" },
  { name: "delete range", old: "a\nb\nc\n", next: "c\n", stdout: "d1 2\n" },
  { name: "original addresses after deletion", old: "a\nb\nc\nd\n", next: "a\nc\nD\n", stdout: "d2\nc4\nD\n.\n" },
  { name: "prepend to empty input", old: "", next: "a\nb\n", stdout: "a0\na\nb\n.\n" },
  { name: "delete all", old: "a\nb\n", next: "", stdout: "d1 2\n" },
  { name: "literal dots", old: "a\n", next: ".\nx\n.\n", stdout: "c1\n.\nx\n.\n.\n" },
  { name: "identical", old: "a\n", next: "a\n", stdout: "" },
  { name: "empty", old: "", next: "", stdout: "" },
  { name: "incomplete old", old: "a", next: "b\n", stdout: "c1\nb\n.\n" },
  { name: "incomplete new", old: "a\n", next: "b", stdout: "c1\nb\n.\n" },
  { name: "identical incomplete", old: "a", next: "a", stdout: "" },
];

for (const buffered of [false, true]) for (const flag of ["-f", "--forward-ed"]) {
  for (const fixture of cases) test(`forward ed ${flag}, buffered ${buffered}: ${fixture.name}`, async () => {
    const files = { old: fixture.old, new: fixture.next };
    const incomplete = Object.entries(files).filter(([, value]) => value && !value.endsWith("\n"));
    const result = await run("diff", [flag, ...(buffered ? ["-I", "^NEVER$"] : []), "old", "new"], { files, buffered });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      exitCode: incomplete.length ? 2 : fixture.old === fixture.next ? 0 : 1,
      stdout: fixture.stdout,
      stderr: incomplete.map(([path]) => `diff: ${path}: No newline at end of file\n\n`).join(""),
    });
  });
}

for (const other of ["-e", "-n", "-u"]) test(`forward ed rejects conflicting ${other} format`, async () => {
  const result = await run("diff", ["-f", other, "old", "new"], { files: { old: "a\n", new: "b\n" } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /conflicting output format/u);
});

test("forward ed permits repeated selectors and honors ignored changes", async () => {
  const result = await run("diff", ["-f", "--forward-ed", "-I", "^skip", "old", "new"], {
    files: { old: "skip old\na\nb\n", new: "skip new\na\nB\n" },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "c3\nB\n.\n");
  assert.equal(result.stderr, "");
});

test("forward ed output remains atomic when its output limit is exceeded", async () => {
  const result = await run("diff", ["-f", "old", "new"], {
    files: { old: "a\nb\nc\n", new: "a\nX\nc\nd\n" }, options: { maxOutputBytes: 10 },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /limit/u);
});

test("forward ed sync shortcut defers incomplete equal files to newline diagnostics", () => {
  const read = () => new TextEncoder().encode("a");
  assert.equal(evalSyncDiff(undefined, ["-f", "old", "new"], read), undefined);
  assert.equal(evalSyncDiff(undefined, ["-fq", "old", "new"], read), "");
});
