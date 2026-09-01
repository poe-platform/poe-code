import assert from "node:assert/strict";
import test from "node:test";
import { diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { snapshot } from "../safety/helpers.js";
import { contents, example, golden, memory, random, run } from "./helpers.js";

test("64 seeded handwritten adjacent/separated hunks retain displaced anchors and reverse", { timeout: 30_000 }, async context => {
  let passed = 0;
  for (let index = 0; index < 64; index++) {
    const seed = (0x17ab0123 + index) >>> 0;
    const pick = random(seed);
    const gap = 1 + pick(7);
    const prefix = Array.from({ length: pick(5) }, (_, offset) => `agent-local-${offset}\n`).join("");
    const middle = Array.from({ length: gap }, (_, offset) => `anchor-${offset}\n`).join("");
    const before = `head\nold-a\n${middle}old-b\ntail\n`;
    const after = `head\nnew-a\ninserted\n${middle}new-b\ntail\n`;
    const input = `--- target\n+++ target\n@@ -1,3 +1,4 @@ function agent_edit\n head\n-old-a\n+new-a\n+inserted\n anchor-0\n@@ -${gap + 3},2 +${gap + 4},2 @@\n-old-b\n+new-b\n tail\n`;
    for (const reverse of [false, true]) {
      const filesystem = await memory({ target: prefix + (reverse ? after : before) });
      const result = await run("patch", reverse ? ["-R", "-F0"] : ["-F0"], filesystem, input);
      assert.equal(result.exitCode, 0, `seed=${seed}, reverse=${reverse}: ${result.stderr}`);
      assert.equal(await contents(filesystem), prefix + (reverse ? before : after), `seed=${seed}`);
    }
    passed++;
  }
  context.diagnostic(`HANDWRITTEN_REPORT ${JSON.stringify({ baseSeed: 0x17ab0123, denominator: 64, pass: passed, fail: 0, skips: 0 })}`);
});

test("all six file-section orderings apply coding-agent create/edit/delete flows and reverse", { timeout: 15_000 }, async context => {
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const edited = golden("export const enabled = false;\n", "export const enabled = true;\n", "config.ts");
  const created = "--- /dev/null\n+++ added.ts\n@@ -0,0 +1 @@\n+export const added = 1;\n";
  const removed = "--- stale.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const stale = 1;\n";
  let virtualPass = 0;
  for (const order of orders) {
    const input = order.map(index => [edited, created, removed][index]!).join("");
    const filesystem = await memory({ "config.ts": "export const enabled = false;\n", "stale.ts": "export const stale = 1;\n" });
    const result = await run("patch", [], filesystem, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(filesystem, "config.ts"), "export const enabled = true;\n");
    assert.equal(await contents(filesystem, "added.ts"), "export const added = 1;\n");
    await assert.rejects(contents(filesystem, "stale.ts"), { code: "ENOENT" });
    const reversed = await run("patch", ["-R"], filesystem, input);
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(filesystem, "config.ts"), "export const enabled = false;\n");
    assert.equal(await contents(filesystem, "stale.ts"), "export const stale = 1;\n");
    await assert.rejects(contents(filesystem, "added.ts"), { code: "ENOENT" });
    virtualPass++;
  }
  context.diagnostic(`ORDER_REPORT ${JSON.stringify({ denominator: 6, virtualPass, skips: 0 })}`);
  assert.equal(virtualPass, 6);
});

const malformed: Readonly<Record<string, string>> = {
  "missing-old-body": "@@ -1,2 +1 @@\n-old\n+new\n",
  "missing-new-body": "@@ -1 +1,2 @@\n-old\n+new\n",
  "extra-old-body": "@@ -1 +1 @@\n-old\n-extra\n+new\n",
  "extra-new-body": "@@ -1 +1 @@\n-old\n+new\n+extra\n",
  "zero-count-noop": "@@ -0,0 +0,0 @@\n",
  "zero-start-nonempty": "@@ -0 +1 @@\n-old\n+new\n",
  "negative-count": "@@ -1,-1 +1 @@\n-old\n+new\n",
  "noninteger-count": "@@ -1,1.5 +1 @@\n-old\n+new\n",
  "orphan-newline-marker": "\\ No newline at end of file\n@@ -1 +1 @@\n-old\n+new\n",
  "duplicate-newline-marker": "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n\\ No newline at end of file\n",
  "empty-incomplete-line": "@@ -1 +1 @@\n-old\n+\n\\ No newline at end of file\n",
  "content-after-incomplete-old": "@@ -1,2 +1 @@\n-old\n\\ No newline at end of file\n-tail\n+new\n",
  "content-after-incomplete-new": "@@ -1 +1,2 @@\n-old\n+new\n\\ No newline at end of file\n+tail\n",
  "missing-physical-newline": "@@ -1 +1 @@\n-old\n+new",
  "header-only": "",
  "context-only-hunk": "@@ -1 +1 @@\n old\n",
};

for (const [name, broken] of Object.entries(malformed)) test(`atomic extension malformed ${name} is not swallowed after a valid file section`, { timeout: 3000 }, async () => {
  const first = golden("keep\n", "changed\n", "first");
  const filesystem = await memory({ first: "keep\n", target: "old\nmiddle\ntail\n" });
  const result = await run("patch", ["--atomic"], filesystem, `${first}--- target\n+++ target\n${broken}`);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(await contents(filesystem, "first"), "keep\n");
  assert.equal(await contents(filesystem), "old\nmiddle\ntail\n");
});

test("atomic extension repeated backward hunk is a conflict without publication", async () => {
  const first = golden("keep\n", "changed\n", "first");
  const filesystem = await memory({ first: "keep\n", target: "old\nmiddle\ntail\n" });
  const before = await snapshot(filesystem);
  const broken = "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n";
  const result = await run("patch", ["--atomic"], filesystem, `${first}--- target\n+++ target\n${broken}`);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "patch: hunk 2 does not match target\n");
  assert.equal(await contents(filesystem, "first"), "keep\n");
  assert.equal(await contents(filesystem), "old\nmiddle\ntail\n");
  assert.deepEqual(await snapshot(filesystem), before);
});

for (const atomic of [false, true]) test(`${atomic ? "atomic extension" : "GNU default"} advisory new coordinate in second hunk remains applicable`, async () => {
  const input = golden("keep\n", "changed\n", "first") + "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n@@ -3 +4 @@\n-tail\n+end\n";
  const filesystem = await memory({ first: "keep\n", target: "old\nmiddle\ntail\n" });
  const result = await run("patch", [...(atomic ? ["--atomic"] : []), "-F0", "-p0"], filesystem, input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(filesystem, "first"), "changed\n");
  assert.equal(await contents(filesystem), "new\nmiddle\nend\n");
});

test("12 actual Shell plugin seeded pipeline/redirection/dry-run/reverse flows", { timeout: 15_000 }, async context => {
  for (const index of [2, 7, 8, 9, 10, 11, 12, 13, 15, 31, 47, 63]) {
    const sample = example(index);
    const filesystem = await memory({ old: sample.before, next: sample.after, target: sample.before });
    const shell = new Shell({ fs: filesystem, cwd: "/work" }).use(diffPatchCommands());
    const piped = await shell.exec(`diff -U${sample.context} --label target --label target old next | patch -F0 >status`);
    assert.equal(piped.exitCode, 0, `seed=${sample.seed}: ${piped.stderr}`);
    assert.equal(piped.stderr, "");
    assert.equal(await contents(filesystem), sample.after);
    const redirected = await shell.exec(`diff -U${sample.context} --label target --label target old next >changes`);
    assert.equal(redirected.exitCode, sample.before === sample.after ? 0 : 1);
    const dry = await shell.exec("patch -R --dry-run -i changes >status");
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.equal(await contents(filesystem), sample.after);
    const backward = await shell.exec("patch -R <changes >status");
    assert.equal(backward.exitCode, 0, backward.stderr);
    assert.equal(await contents(filesystem), sample.before);
  }
  context.diagnostic("SHELL_REPORT denominator=12 pass=12 fail=0 skips=0");
});

for (const atomic of [false, true]) test(`${atomic ? "atomic extension" : "GNU default"} repeated hunk cannot bypass its first misordered match for a later duplicate`, async () => {
  const initial = "old\nmiddle\nold\n";
  const input = golden("keep\n", "changed\n", "first") + "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n";
  const filesystem = await memory({ first: "keep\n", target: initial });
  const before = await snapshot(filesystem);
const expected = { first: "changed\n", target: "new\nmiddle\nold\n", "target.orig": initial,
      "target.rej": "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+other\n" };
const result = await run("patch", atomic ? ["--atomic"] : [], filesystem, input);
assert.equal(result.exitCode, 1, result.stderr);
if (atomic) {
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "patch: hunk 2 does not match target\n");
      assert.deepEqual(await snapshot(filesystem), before);
    } else {
      assert.equal(result.stdout, "patching file first\npatching file target\nmisordered hunks! output would be garbled\nHunk #2 FAILED at 1.\n1 out of 2 hunks FAILED -- saving rejects to file target.rej\n");
      assert.equal(result.stderr, "");
      assert.deepEqual((await filesystem.readdir("/work")).map(entry => entry.name).sort(), Object.keys(expected).sort());
      for (const [name, bytes] of Object.entries(expected)) assert.equal(await contents(filesystem, name), bytes);
    }
});
