import assert from "node:assert/strict";
import test from "node:test";
import { Pattern, substitute } from "../../../src/commands/text-programs/regex.js";
import { Budget, ProgramError } from "../../../src/commands/text-programs/shared.js";
import { ReplacementBuffer } from "../../../src/commands/text-programs/replacement-buffer.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { runVirtual } from "./helpers.js";

function createBudget(maxSteps = 10000, maxBufferBytes = 4096, signal = new AbortController().signal): Budget {
  return new Budget({
    command: "sed", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("substitution must not emit stdout"); } },
    stderr: { async write() { assert.fail("substitution must not emit stderr"); } },
  }, { maxSteps, maxBufferBytes });
}

test("substitution refuses oversized replacement before constructing a checked string", async context => {
  const budget = createBudget(10000, 64);
  const check = context.mock.method(budget, "check");
  const allocate = context.mock.method(Buffer, "allocUnsafeSlow");
  await assert.rejects(async () => await substitute("aa", new Pattern("a"), "&".repeat(80), budget, true), { message: "text buffer limit exceeded" });
  assert.deepEqual(check.mock.calls.filter(call => call.arguments[0].length > 64), []);
  assert.equal(allocate.mock.calls.length, 0);
});

test("substitution work increases with capture copying rather than only matching", async context => {
  const costs: number[] = [];
  for (const copies of [1, 32]) {
    const budget = createBudget();
    const step = context.mock.method(budget, "step");
    const result = await substitute("aaaa", new Pattern("a"), "&".repeat(copies), budget, true);
    assert.deepEqual(result, { text: "a".repeat(4 * copies), count: 4 });
    costs.push(step.mock.calls.reduce((total, call) => total + (call.arguments[0] ?? 1), 0));
  }
  assert.ok(costs[1]! >= costs[0]! + 124, `copying 124 more bytes cost only ${costs[1]! - costs[0]!} extra steps`);
});

test("replacement work refusal happens before owned byte allocation", async context => {
  const allocate = context.mock.method(Buffer, "allocUnsafeSlow");
  await assert.rejects(async () => await substitute("a", new Pattern("a"), "&".repeat(80), createBudget(32, 128), false), { message: "execution step limit exceeded" });
  assert.equal(allocate.mock.calls.length, 0);
});

for (const queued of [false, true]) {
  test(`replacement ${queued ? "queued" : "immediate"} cancellation stops expansion`, async context => {
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: queued });
    const pattern = new Pattern("a");
    const find = pattern.find.bind(pattern);
    let reads = 0;
    context.mock.method(pattern, "find", (...args: Parameters<Pattern["find"]>) => {
      const match = find(...args);
      if (!match) return match;
      return { ...match, groups: new Proxy(match.groups, {
        get(target, key, receiver) {
          if (key === "0") {
            reads++;
            if (reads === 1) {
              if (queued) queueMicrotask(() => controller.abort(reason));
              else controller.abort(reason);
            }
          }
          return Reflect.get(target, key, receiver);
        },
      }) };
    });
    await assert.rejects(async () => await substitute("a", pattern, "&".repeat(257), createBudget(10000, 4096, controller.signal), false), error => error === reason);
    assert.ok(reads <= (queued ? 256 : 1), `expansion performed ${reads} group reads after scheduled cancellation`);
  });
}

test("replacement byte semantics preserve captures, escapes, occurrence and empty matches", async () => {
  for (const [source, expression, replacement, global, occurrence, expected, count] of [
    ["aba", "a", "<&>", true, 1, "<a>b<a>", 2],
    ["aba", "a", "X", true, 2, "abX", 1],
    ["ab", "a*", "X", true, 1, "XbX", 2],
    ["ab", "(a)(b)", "\\2-\\1-\\&", false, 1, "b-a-&", 1],
    ["a", "(a)(b)?", "\\2\\n\\t\\", false, 1, "\n\t\\", 1],
    ["\x00\xff", ".", "&&", true, 1, "\x00\x00\xff\xff", 2],
  ] as const) {
    assert.deepEqual(await substitute(source, new Pattern(expression), replacement, createBudget(), global, occurrence), { text: expected, count });
  }
});

test("sed and awk preserve expanded bytes and discarded intermediates", async () => {
  const replacement = "&".repeat(8);
  for (const [tool, args, expected] of [
    ["sed", [`s/a/${replacement}/g`], "a".repeat(32) + "\n"],
    ["sed", ["-n", `s/a/${replacement}/g`], ""],
    ["awk", [`{gsub(/a/,"${replacement}"); print length($0)}`], "32\n"],
  ] as const) {
    const result = await runVirtual(tool, { args, stdin: "aaaa\n" }, { maxBufferBytes: 128 });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
  }
});

test("awk continues to reject replacement backreference escapes", async () => {
  const result = await runVirtual("awk", { args: ['{gsub(/a/,"\\\\1"); print}'], stdin: "a\n" });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /replacement backreference escapes are not supported/u);
  assert.equal(result.stdout.length, 0);
});

test("replacement exact logical capacity remains available", async () => {
  const result = await substitute("aa", new Pattern("a"), "&".repeat(32), createBudget(10000, 64), true);
  assert.deepEqual(result, { text: "a".repeat(64), count: 2 });
  await assert.rejects(async () => await substitute("aa", new Pattern("a"), "&".repeat(33), createBudget(10000, 64), true), error => error instanceof ProgramError && error.message === "text buffer limit exceeded");
});

test("replacement segment and finalization capacities are independently bounded", async context => {
  const budget = createBudget(10000, 1025);
  const buffer = new ReplacementBuffer(budget);
  const allocate = context.mock.method(Buffer, "allocUnsafeSlow");
  const original = Buffer.prototype.toString;
  let releasedBeforeConversion = false;
  context.mock.method(Buffer.prototype, "toString", function (this: Buffer, encoding?: BufferEncoding, start?: number, end?: number) {
    if (encoding === "latin1" && this.length === 1025) releasedBeforeConversion = buffer.remaining === 1025;
    return original.call(this, encoding, start, end);
  });
  await buffer.append("x".repeat(1025));
  assert.equal(await buffer.finish(), "x".repeat(1025));
  assert.deepEqual(allocate.mock.calls.map(call => call.arguments[0]), [1024, 1, 1025]);
  assert.equal(releasedBeforeConversion, true);
});

test("replacement scratch does not retain a pooled backing store beyond its capacity", async context => {
  const allocate = context.mock.method(Buffer, "allocUnsafeSlow");
  const buffer = new ReplacementBuffer(createBudget(1000, 64));
  await buffer.append("x".repeat(64));
  assert.equal(allocate.mock.calls.length, 1);
  const allocated = allocate.mock.calls[0]?.result;
  assert.ok(allocated);
  assert.equal(allocated.buffer.byteLength, 64);
  assert.equal((await buffer.finish()).length, 64);
});

for (const size of [4, 1025]) {
  test(`replacement builder charges actual copy and conversion work at size ${size}`, async context => {
    const cost = size === 4 ? 9 : 3077;
    const buffer = new ReplacementBuffer(createBudget(cost, size));
    await buffer.append("x".repeat(size));
    assert.equal((await buffer.finish()).length, size);
    const limited = new ReplacementBuffer(createBudget(cost - 1, size));
    await limited.append("x".repeat(size));
    const allocate = context.mock.method(Buffer, "allocUnsafeSlow");
    await assert.rejects(limited.finish(), { message: "execution step limit exceeded" });
    assert.equal(allocate.mock.calls.length, 0);
    limited.clear();
    assert.equal(limited.remaining, size);
  });
}

for (const reason of [0, false, "", null]) {
  test(`replacement finalization rechecks queued cancellation ${JSON.stringify(reason)}`, async context => {
    const controller = new AbortController();
    const budget = createBudget(10000, 64, controller.signal);
    const buffer = new ReplacementBuffer(budget);
    await buffer.append("abcd");
    const convert = context.mock.method(Buffer.prototype, "toString");
    context.mock.method(budget, "checkpoint", async () => { queueMicrotask(() => controller.abort(reason)); });
    try {
      await assert.rejects(buffer.finish(), error => error === reason);
      assert.equal(convert.mock.calls.length, 0);
    } finally { buffer.clear(); }
    assert.equal(buffer.remaining, 64);
  });
}

test("substitution clears owned scratch on materialization failure", async context => {
  const clear = context.mock.method(ReplacementBuffer.prototype, "clear");
  await assert.rejects(async () => await substitute("aa", new Pattern("a"), "&".repeat(33), createBudget(10000, 64), true), { message: "text buffer limit exceeded" });
  assert.equal(clear.mock.calls.length, 1);
  const owner = clear.mock.calls[0]!.this;
  assert.ok(owner instanceof ReplacementBuffer);
  assert.equal(owner.remaining, 64);
});

test("global deletion observes queued cancellation between matches", async context => {
  const controller = new AbortController();
  const reason = Object.freeze({ betweenMatches: true });
  const pattern = new Pattern("a");
  const original = pattern.find.bind(pattern);
  let matches = 0;
  context.mock.method(pattern, "find", (...args: Parameters<Pattern["find"]>) => {
    const match = original(...args);
    if (match) { matches++; queueMicrotask(() => controller.abort(reason)); }
    return match;
  });
  await assert.rejects(substitute("aaaa", pattern, "", createBudget(10000, 64, controller.signal), true), error => error === reason);
  assert.equal(matches, 1);
});

test("discarded replacements are not charged to the shell output allowance", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(textProgramCommands({ maxBufferBytes: 128 }));
  context.after(() => shell.dispose());
  for (const [source, stdout] of [
    ["sed -n 's/a/&&&&&&&&/g'", ""],
    ['awk \'{gsub(/a/,"&&&&&&&&"); print length($0)}\'', "32\n"],
  ]) {
    const result = await shell.exec(source!, { stdin: "aaaa\n", limits: { maxOutputBytes: 8 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
  }
});
