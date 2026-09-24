import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern } from "../../../src/commands/text-programs/regex.js";
import { Budget, ProgramError } from "../../../src/commands/text-programs/shared.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { runVirtual } from "./helpers.js";

test("oversized regex programs are rejected before emitting any instruction", () => {
  const push = Array.prototype.push;
  let emitted = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    if (items.some(item => item !== null && typeof item === "object" && "kind" in item)) {
      emitted++;
      throw new Error("instruction emitted before preflight");
    }
    return push.apply(this, items);
  };
  try {
    for (const source of ["a{700000}", "(a{200}){200}", "a{0,700000}", "a{700000,}", "(a|b){10000}", "(){9007199254740991}"]) {
      assert.throws(() => new Pattern(source), error => error instanceof ProgramError && error.message === "regular expression program limit exceeded", source);
    }
  } finally { Array.prototype.push = push; }
  assert.equal(emitted, 0);
});

test("sed refuses a short high-repeat pattern under low work and buffer budgets", async () => {
  for (const args of [["-E", "s/a{700000}/x/"], [String.raw`s/a\{700000\}/x/`], ["-nE", "/a{700000}/p"]]) {
    const result = await runVirtual("sed", { args }, { maxSteps: 16, maxBufferBytes: 64 });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "sed: regular expression program limit exceeded\n");
    assert.equal(result.stdout.length, 0);
  }
});

test("sed charges compilation work before consuming input or touching output files", async context => {
  let reads = 0;
  const source = (async function* () { reads++; yield Buffer.from("a\n"); })();
  const step = Budget.prototype.step;
  let charged = 0;
  context.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) { charged += count; step.call(this, count); });
  const result = await runVirtual("sed", { args: ["-E", "s/a{100}/x/w result"], files: { result: "keep" } }, { maxSteps: 16 }, source);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "sed: execution step limit exceeded\n");
  assert.equal(result.files.result?.toString(), "keep");
  assert.equal(reads, 0);
  assert.ok(charged >= 101);
});

test("regex preflight includes captures, branches, optional repeats and the final match", async () => {
  for (const [accepted, rejected] of [
    ["a{16383}", "a{16384}"],
    ["a{16380,}", "a{16381,}"],
    ["a{0,8191}", "a{0,8192}"],
    ["(a){5461}", "(a){5462}"],
    ["(a|b){2730}", "(a|b){2731}"],
    ["(a{126}){127}", "(a{127}){128}"],
  ] as const) {
    const pattern = new Pattern(accepted);
    await pattern.prepare({ step() {}, async checkpoint() {} });
    assert.throws(() => new Pattern(rejected), { message: "regular expression program limit exceeded" });
  }
});

test("jq preflight preserves assertion costs and skips enormous zero-instruction repeats", async () => {
  assert.throws(() => new Pattern("(?=a{16381})a", true, false, "jq"), { message: "jq regular expression program limit exceeded" });
  const work = { step() {}, async checkpoint() {}, maxBufferBytes: 8192 };
  for (const source of ["(?:){9007199254740991}", "(?:){9007199254740991,}", "(?:a{700000}){0}"]) {
    assert.deepEqual(await new Pattern(source, true, false, "jq").find("", work), { start: 0, end: 0, groups: [""] }, source);
  }
  assert.deepEqual(await new Pattern("(?:(a{700000})){0}", true, false, "jq").find("", work), { start: 0, end: 0, groups: ["", undefined] });
  assert.deepEqual(await new Pattern("(?=a{2})a+?", true, false, "jq").find("aa", work), { start: 0, end: 1, groups: ["a"] });
});

test("regex tree limits bound parsing before projection", () => {
  assert.throws(() => new Pattern("a".repeat(8193)), { message: "regular expression source limit exceeded" });
  assert.throws(() => new Pattern("(".repeat(65) + "a" + ")".repeat(65)), { message: "regular expression depth limit exceeded" });
  assert.doesNotThrow(() => new Pattern("(".repeat(64) + "a" + ")".repeat(64)));
});

test("empty alternatives checkpoint their emitted branch instructions", async () => {
  const pattern = new Pattern("|".repeat(8000));
  const push = Array.prototype.push;
  let emitted = 0;
  let previous = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    if (items.some(item => item !== null && typeof item === "object" && "kind" in item)) emitted += items.length;
    return push.apply(this, items);
  };
  try {
    await pattern.prepare({ step() {}, async checkpoint() {
      assert.ok(emitted - previous <= 128, `emitted ${emitted - previous} branch instructions between checkpoints`);
      previous = emitted;
    } });
    assert.equal(emitted, 16001);
  } finally { Array.prototype.push = push; }
});

for (const reason of [false, null]) {
  test(`interrupted regex compilation can be retried without publishing partial code: ${String(reason)}`, async () => {
    const pattern = new Pattern("(a|b){100}");
    let checkpoints = 0;
    await assert.rejects(pattern.prepare({ step() {}, async checkpoint() { if (++checkpoints === 3) throw reason; } }), error => error === reason);
    const work = { step() {}, async checkpoint() {}, maxBufferBytes: 1024 * 1024 };
    const text = "ab".repeat(50);
    assert.deepEqual(await pattern.find(text, work), { start: 0, end: 100, groups: [text, "b"] });
  });
}

test("sed compilation yields to the shell CPU limit within an admitted repeat", async context => {
  let now = 0;
  let emitted = 0;
  context.mock.method(performance, "now", () => now);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(textProgramCommands({ maxBufferBytes: 64 }));
  const push = Array.prototype.push;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) {
      if (item !== null && typeof item === "object" && "kind" in item && item.kind === "character" && "accepts" in item) { now++; emitted++; }
    }
    return push.apply(this, items);
  };
  try {
    await assert.rejects(shell.exec("sed -E 's/a{8000}/x/'", { limits: { maxCpuMs: 25, maxOutputBytes: 128 } }),
      error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.ok(emitted > 0 && emitted <= 64, `emitted ${emitted} instructions before the CPU checkpoint`);
  } finally { Array.prototype.push = push; await shell.dispose(); }
});
