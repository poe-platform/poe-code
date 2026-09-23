import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { run } from "./helpers.js";

for (const [expression, input, expected] of [
  ["upcase", "Ab\n", "AB\n"],
  ["downcase", "Ab\n", "ab\n"],
  ["upcase", "éß\n", "Éß\n"],
  ["downcase", "İÉ\n", "ié\n"],
  ['test("^A")', "Ab\n", "true\n"],
  ['split(",")', "a,b\n", "- a\n- b\n"],
  ['split(",")', "a,,b,\n", "- a\n- \"\"\n- b\n- \"\"\n"],
  ['split("")', "é😀\n", "- é\n- 😀\n"],
  ['test("^a[[:digit:]]+$")', "a123\n", "true\n"],
  ['test("^a$")', "abc\n", "false\n"],
  ['test("^.$")', "é\n", "true\n"],
  ['test("a.b")', '"a\\nb"\n', "false\n"],
] as const) test(`Mike yq string operator ${expression} on ${JSON.stringify(input)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from(input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec(`yq '${expression}' /input.yaml`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("Mike yq regex rejects unsupported Go syntax rather than changing its meaning", async () => {
  for (const expression of ['test("(?=a)")', 'test("[\\\\d]")', 'test("[]\\\\d]")', 'test("[[:digit:]\\\\d]")', 'test("(a)\\\\1")']) {
    const result = await run([expression], "a\n");
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});

test("Mike yq string operators honor the invocation work budget", async () => {
  const result = await run(['test("(a|aa)*b")'], `${"a".repeat(80)}\n`, {}, { limits: { maxSteps: 300 } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /maxSteps|limit exceeded/u);
});

test("Mike yq regex work observes cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel yq regex");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(run(['test("a*")'], `${"a".repeat(30000)}\n`, { signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
});
