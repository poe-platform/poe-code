import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { Budget, JqLimitError, resolveJqLimits } from "../../src/commands/structured/limits.js";
import { splitRegex } from "../../src/commands/structured/splits.js";

const cases: readonly [string, unknown][] = [
  ['[splits(",")]', "a,b,c"],
  ['splits(",")', "a,b,c"],
  ['[splits(",")]', ",a,,b,"],
  ['[splits(",")]', ""],
  ['[splits(",")]', "abc"],
  ['[splits("[,;]+")]', "a,,b;c"],
  ['[splits("(,)")]', "a,b,c"],
  ['[splits("a|ab")]', "abc"],
  ['[splits("a+?")]', "aaab"],
  ['[splits("")]', "a😀b"],
  ['[splits("^")]', "😀b"],
  ['[splits("(?=😀)")]', "😀b"],
  ['[splits("a*")]', "😀a"],
  ['[splits(".")]', "a😀b"],
  ['[splits("😀+")]', "a😀😀b"],
  ['[splits("(?!b)")]', "abc"],
  ['[splits("(?<=b)")]', "abc"],
  ['[splits("(?<!b)")]', "abc"],
  ['[splits("(?=(b))")]', "abc"],
  ['[splits("[[:space:]]+")]', "a b\tc"],
  ['[splits("^|$")]', "abc"],
  ['[splits("a*")]', "abc"],
  ['[splits("(?=b)")]', "abc"],
  ['[splits(",", ";")]', "a,b;c"],
  ['[splits(empty)]', "abc"],
  ['first(splits(","))', "a,b,c"],
  ['splits(",")', 3],
  ['splits(3)', "abc"],
  ['try splits(null) catch .', "abc"],
  ['splits("[")', "abc"],
  ['splits("(")', "abc"],
  ['splits("*")', "abc"],
  ['splits("[z-a]")', "abc"],
  ['splits("(?<=a*)")', "abc"],
];

for (const [filter, input] of cases) test(`jq native splits parity: ${filter} on ${JSON.stringify(input)}`, async () => {
  const stdin = `${JSON.stringify(input)}\n`;
  const native = spawnSync("/usr/bin/jq", ["-c", filter], { input: stdin, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      exitCode: native.status, stdout: native.stdout, stderr: native.stderr,
    });
  } finally {
    await shell.dispose();
  }
});

test("regex splitting remains cancellable during backtracking", async () => {
  const controller = new AbortController();
  const reason = new Error("stop regex");
  const iterator = splitRegex(`a,${"a".repeat(1000)}!`, ",|(?<=,)(a+)+$", new Budget(resolveJqLimits(), controller.signal));
  assert.deepEqual(await iterator.next(), { value: "a", done: false });
  const pending = iterator.next();
  const timer = setTimeout(() => controller.abort(reason), 20);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); await iterator.return(undefined); }
});

test("streamed fields share the jq work budget", async () => {
  const iterator = splitRegex("a,b,c", ",", new Budget(resolveJqLimits({ maxSteps: 12 }), new AbortController().signal));
  await assert.rejects(async () => { for await (const field of iterator) void field; }, JqLimitError);
});

test("regex search shares the noncatchable jq work budget", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ structured: { limits: { maxSteps: 1000 } } }));
  try {
    const result = await shell.exec(`jq -c 'try [splits("(a+)+$")] catch "caught"'`, { stdin: `${JSON.stringify("a".repeat(20) + "!")}\n` });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /maxSteps limit exceeded/u);
  } finally { await shell.dispose(); }
});
