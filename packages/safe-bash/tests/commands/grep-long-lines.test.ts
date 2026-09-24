import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider } from "../../src/index.js";
import { EreLedger } from "../../src/commands/regex-execution/ere/limits.js";
import { createEreSpanMatcher, matchEre } from "../../src/commands/regex-execution/ere/matcher.js";
import { compileEre } from "../../src/commands/regex-execution/ere/syntax.js";

const pattern = "blocked|security|network error|access denied|whoa there|request has been blocked|challenge|captcha|forbidden";
const inputs = [
  ["4 KiB line", `- generic: ${"x".repeat(4096)}\n`],
  ["16 KiB line", `- generic: ${"x".repeat(16384)}\n`],
  ["1000 short lines", `${"x".repeat(75)}\n`.repeat(1000)],
  ["late mixed-case match", `- generic: ${"x".repeat(16384)} NeTwOrK ErRoR\n`],
] as const;

for (const [name, input] of inputs) for (const bounded of [false, true]) {
  test(`grep -Ei agrees with native grep for ${name}, explicit budget=${bounded}`, async t => {
    const expected = spawnSync("/usr/bin/grep", ["-Ei", "-m", "20", pattern], {
      input, encoding: "utf8", env: { ...process.env, LC_ALL: "C" },
    });
    assert.ifError(expected.error);
    assert.equal(expected.signal, null);
    assert.equal(expected.status, name === "late mixed-case match" ? 0 : 1);
    assert.equal(expected.stderr, "");
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands(bounded
      ? { regexExecutor: createBoundedRegexProvider({ maxAllocationUnits: 1_000_000 }) }
      : {}));
    t.after(() => shell.dispose());
    const actual = await shell.exec(`grep -Ei -m 20 '${pattern}'`, { stdin: input });
    assert.deepEqual({ status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, {
      status: expected.status, stdout: expected.stdout, stderr: expected.stderr,
    });
  });
}

test("nonmatching ERE search does not allocate task chains at every impossible start", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, {
    allocationUnits: 10_000, work: 100_000,
  });
  const program = await compileEre(pattern, ledger, undefined, true);
  assert.equal((await matchEre(program, "x".repeat(4096), ledger)).matched, false);
  const before = ledger.usage;
  assert.equal((await matchEre(program, "x".repeat(16384), ledger)).matched, false);
  assert.ok(ledger.usage.allocationUnits - before.allocationUnits < 100);
  assert.ok(ledger.usage.work - before.work < 3 * 16384);
});

for (const [expression, subject, values] of [
  ["a?b", "xxB", ["B"]],
  ["(ab|c)*d", "xxcD", ["cD", "c"]],
  ["a{0}b", "xxB", ["B"]],
  ["(a|)b", "xxB", ["B", ""]],
  ["(^a|b)c", "xxBC", ["BC", "B"]],
  ["^a|b$", "xxB", ["B"]],
  ["^a", "xxA", []],
  ["$", "abc", [""]],
  ["a*", "xxx", [""]],
  ["(a|ab)(b?)", "xxAB", ["AB", "AB", ""]],
  ["[b-d]x", "xxCx", ["Cx"]],
  ["[^a]+b", "aaCB", ["CB"]],
  [".b", "xxaB", ["aB"]],
] as const) test(`ERE search preserves captures, nullable prefixes and anchors: ${expression}`, async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre(expression, ledger, undefined, true);
  const result = await matchEre(program, subject, ledger);
  assert.equal(result.matched, values.length > 0);
  assert.deepEqual(result.values, values);
});

test("long nonmatching scans preserve live cancellation after subject preparation", async () => {
  const controller = new AbortController();
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre(pattern, ledger, controller.signal, true);
  await matchEre(program, "", ledger, controller.signal);
  const scan = await createEreSpanMatcher(program, "x".repeat(16384), ledger, controller.signal);
  const pending = scan(0);
  const rejected = assert.rejects(pending, reason => reason === false);
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort(false);
  await rejected;
});

for (const [options, diagnostic] of [
  [{ maxInputBytes: 65536 }, "aggregate input byte limit exceeded"],
  [{ maxAllocationUnits: 512 }, "allocationUnits (512)"],
  [{ maxWork: 512 }, "work (512)"],
] as const) test(`grep still enforces ${diagnostic} and recovers`, async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider(options) }));
  t.after(() => shell.dispose());
  const refused = await shell.exec(`grep -Ei '${pattern}'`, { stdin: `- generic: ${"x".repeat(65536)}\n` });
  assert.equal(refused.exitCode, 2);
  assert.equal(refused.stdout, "");
  assert.ok(refused.stderr.includes(diagnostic), refused.stderr);
  const recovered = await shell.exec("grep -Ei x", { stdin: "X\n" });
  assert.equal(recovered.exitCode, 0, recovered.stderr);
  assert.equal(recovered.stderr, "");
  assert.equal(recovered.stdout, "X\n");
});
