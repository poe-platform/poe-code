import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern, substitute } from "../../../src/commands/text-programs/regex.js";
import { Budget, ProgramError } from "../../../src/commands/text-programs/shared.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { runVirtual } from "./helpers.js";

function makeBudget(maxSteps = 2048, maxBufferBytes = 8192, signal = new AbortController().signal): Budget {
  return new Budget({
    command: "sed", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, { maxSteps, maxBufferBytes });
}

test("NFA yields inside one find before its small work limit and preserves queued cancellation", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: "inside find" });
  const budget = makeBudget(512, 32768, controller.signal);
  const step = budget.step.bind(budget);
  context.mock.method(budget, "step", (count = 1) => { now += count; step(count); });
  const abort = setImmediate(() => controller.abort(reason));
  try {
    await assert.rejects(async () => await new Pattern("(a*)(a*)b").find("aaaaaaaa", budget), error => error === reason);
  } finally { clearImmediate(abort); }
});

test("NFA combines visited and queued storage rather than admitting both independently", async () => {
  await assert.rejects(async () => await new Pattern("(a*)(a*)b").find("aaaa", makeBudget(2048, 1450)),
    error => error instanceof ProgramError && error.message === "regular expression state buffer limit exceeded");
});

test("NFA refuses a capture state before serializing its key", async () => {
  const pattern = new Pattern("(a)");
  const join = Array.prototype.join;
  let joins = 0;
  Array.prototype.join = function (this: unknown[], separator?: string) {
    if (separator === "," && this.every(value => typeof value === "number" || value === undefined)) joins++;
    return join.call(this, separator);
  };
  try {
    await assert.rejects(async () => await pattern.find("a", makeBudget(2048, 350)),
      error => error instanceof ProgramError && error.message === "regular expression state buffer limit exceeded");
  } finally { Array.prototype.join = join; }
  assert.equal(joins, 0);
});

test("find observes an existing falsey cancellation even beyond the final offset", async () => {
  const controller = new AbortController();
  controller.abort(false);
  await assert.rejects(async () => await new Pattern("a").find("a", makeBudget(2048, 8192, controller.signal), 2), error => error === false);
});

test("NFA releases each search's ledger after successful and missing matches", async () => {
  const pattern = new Pattern("(a)b");
  const budget = makeBudget(20000, 2048);
  for (let iteration = 0; iteration < 16; iteration++) {
    assert.equal(await pattern.find("ac", budget), undefined);
    assert.deepEqual(await pattern.find("aaaaab", budget), { start: 4, end: 6, groups: ["ab", "a"] });
  }
});

test("NFA failed admissions and falsey cancellations do not poison a reusable pattern", async () => {
  const pattern = new Pattern("(a)");
  await assert.rejects(pattern.find("a", makeBudget(2048, 350)), { message: "regular expression state buffer limit exceeded" });
  await assert.rejects(pattern.find("a", makeBudget(4)), { message: "execution step limit exceeded" });
  for (const reason of [undefined, null, false, 0, "", Object.freeze({ cancelled: true })]) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(pattern.find("a", makeBudget(2048, 8192, controller.signal)), error => error === controller.signal.reason);
    assert.deepEqual(await pattern.find("a", makeBudget()), { start: 0, end: 1, groups: ["a", "a"] });
  }
});

test("interleaved searches on one compiled pattern retain independent ledgers", async context => {
  const pattern = new Pattern("(a)");
  const budget = makeBudget();
  let resume!: () => void;
  let reached!: () => void;
  const suspended = new Promise<void>(resolve => { reached = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const checkpoint = budget.checkpoint.bind(budget);
  let checkpoints = 0;
  context.mock.method(budget, "checkpoint", async () => {
    if (++checkpoints === 2) { reached(); await waiting; }
    await checkpoint();
  });
  const pending = pattern.find("a", budget);
  await suspended;
  try {
    await assert.rejects(pattern.find("a", makeBudget(2048, 350)), { message: "regular expression state buffer limit exceeded" });
    assert.deepEqual(await pattern.find("a", makeBudget()), { start: 0, end: 1, groups: ["a", "a"] });
  } finally { resume(); }
  assert.deepEqual(await pending, { start: 0, end: 1, groups: ["a", "a"] });
});

test("resumable matching retains the existing 64-byte replacement capacity", async () => {
  assert.deepEqual(await substitute("aa", new Pattern("a"), "&".repeat(32), makeBudget(10000, 64), true),
    { text: "a".repeat(64), count: 2 });
  await assert.rejects(substitute("aa", new Pattern("a"), "&".repeat(33), makeBudget(10000, 64), true),
    error => error instanceof ProgramError && error.message === "text buffer limit exceeded");
});

test("matching retains capture preference, unmatched groups, anchors, offsets, backreferences and bytes", async () => {
  for (const [source, text, from, extended, ignoreCase, expected] of [
    ["(a|aa)(a?)", "aa", 0, true, false, { start: 0, end: 2, groups: ["aa", "aa", ""] }],
    ["(a*)(a*)", "aa", 0, true, false, { start: 0, end: 2, groups: ["aa", "aa", ""] }],
    ["(a)?b", "b", 0, true, false, { start: 0, end: 1, groups: ["b", undefined] }],
    ["(a|aa)*", "aa", 0, true, false, { start: 0, end: 2, groups: ["aa", "aa"] }],
    ["^a", "ba", 1, true, false, undefined],
    ["a$", "ba", 1, true, false, { start: 1, end: 2, groups: ["a"] }],
    ["^|$", "a", 1, true, false, { start: 1, end: 1, groups: [""] }],
    ["\\(a*\\)\\1", "aaaa", 0, false, false, { start: 0, end: 4, groups: ["aaaa", "aa"] }],
    ["(a)\\1", "aA", 0, true, true, { start: 0, end: 2, groups: ["aA", "a"] }],
    ["a*", "ba", 0, true, false, { start: 0, end: 0, groups: [""] }],
    [".", "\x00\xff", 1, true, false, { start: 1, end: 2, groups: ["\xff"] }],
  ] as const) {
    assert.deepEqual(await new Pattern(source, extended, ignoreCase).find(text, makeBudget(), from), expected);
  }
});

for (const [tool, args, stdin, expected] of [
  ["sed", ["-n", "/z/p"], "a\n", ""],
  ["sed", ["s/z/X/"], "a\n", "a\n"],
  ["awk", ['/z/ { print "bad" }'], "a\n", ""],
  ["awk", ['{ print ($0 ~ /z/), ($0 !~ /z/) }'], "a\n", "0 1\n"],
  ["awk", ['{ print match($0,/z/), RSTART, RLENGTH }'], "a\n", "0 0 -1\n"],
  ["awk", ['BEGIN { print split("a b",parts,/ /), parts[1], parts[2] }'], "", "2 a b\n"],
  ["awk", ['BEGIN { FS="[ ]"; $0="a b"; print NF, $1, $2 }'], "", "2 a b\n"],
] as const) {
  test(`${tool} awaits the match result: ${args[0]}`, async context => {
    context.mock.method(Pattern.prototype, "find", (text: string, _budget: Budget, from = 0) => Promise.resolve(
      text === "a b" && from === 0 ? { start: 1, end: 2, groups: [" "] } : undefined,
    ));
    const result = await runVirtual(tool, { args, stdin }, { maxSteps: 512, maxBufferBytes: 8192 });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
  });
}
