import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import { inputBytes, type GlobDescriptor } from "../../../../src/commands/regex-execution/protocol.js";
import { Glob, ignoreRules, matchGlobs } from "../../../../src/commands/search/glob.js";

test("worker globs retain code-unit strings, Unicode predicates and ancestor policy", async () => {
  const executor = new RegexExecutor();
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  try {
    const cases: readonly [string, string, boolean, boolean, boolean, boolean][] = [
      ["?.ts", "🙂.ts", false, false, false, true],
      ["\ud800.ts", "\ud800.ts", false, false, false, true],
      ["\ud800.ts", "�.ts", false, false, false, false],
      ["k.ts", "K.ts", false, false, true, true],
      ["sub/", "sub/file", false, true, false, true],
      ["sub/", "sub/file", false, false, false, false],
      ["sub/", "sub", false, false, false, false],
      ["sub/", "sub", true, false, false, true],
      ["**/alpha", "dir/alpha", false, false, false, true],
      ["**/alpha", "dir\n/alpha", false, false, false, false],
      ["[!a-c]", "z", false, false, false, true],
      ["{alpha,{beta,gamma}}", "beta", false, false, false, true],
    ];
    const globs = cases.map(([source, , , , insensitive]) => new Glob(source, insensitive));
    const candidates = cases.map(([, path, directory, ancestors]) => ({ path, directory, ancestors }));
    assert.deepEqual(await matchGlobs(globs, candidates, session), cases.map(([, , , , , expected]) => expected));
  } finally { await session.close(); await executor.dispose(); }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("glob validation preserves first invalid rule and ignore-file literal brackets", async () => {
  const executor = new RegexExecutor();
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(matchGlobs([new Glob("[z-a]"), new Glob("{")], [], session), /Range out of order/u);
    await assert.rejects(matchGlobs([new Glob("{"), new Glob("[z-a]")], [], session), /unclosed glob brace/u);
    await assert.rejects(matchGlobs([new Glob("alpha[")], [], session), /unclosed glob character class/u);
    const rules = await ignoreRules("# ignored\nalpha[\n!beta\\ \n", "/", 2, session);
    assert.deepEqual(rules.map(rule => [rule.glob.source, rule.include]), [["alpha[", false], ["beta\\ ", true]]);
    assert.equal(await rules[0]!.glob.matches("alpha[", false, session, false), true);
    assert.equal(await rules[1]!.glob.matches("beta ", false, session, false), true);
  } finally { await session.close(); await executor.dispose(); }
});

test("glob batching caps ordinary descriptors without reordering matches", async () => {
  const executor = new RegexExecutor();
  const session = executor.open(new AbortController().signal);
  const original = executor.request.bind(executor);
  const requests: { patterns: number; rows: number; bytes: number }[] = [];
  executor.request = (descriptor, rows, signal) => {
    requests.push({ patterns: descriptor.patterns.length, rows: rows.length, bytes: inputBytes(descriptor, rows, signal) });
    return original(descriptor, rows, signal);
  };
  try {
    const globs = Array.from({ length: 260 }, (_, index) => new Glob(index % 2 ? "alpha.*" : "beta.*"));
    const matches = await matchGlobs(globs, globs.map(() => ({ path: "alpha.ts", directory: false, ancestors: false })), session);
    assert.deepEqual(matches, globs.map((_, index) => Boolean(index % 2)));
    assert.deepEqual(requests.map(request => [request.patterns, request.rows]), [[128, 128], [128, 128], [4, 4]]);
    assert.ok(requests.every(request => request.bytes <= 64 * 1024));
  } finally { await session.close(); await executor.dispose(); }
});

test("glob queue accounting includes options and UTF16LE path bytes", () => {
  const descriptor: GlobDescriptor = { kind: "glob", patterns: ["alpha.*"], globOptions: [{ insensitive: false, literalUnclosedClass: false }] };
  const signal = new AbortController().signal;
  assert.equal(inputBytes(descriptor, [{ bytes: Buffer.from("🙂.ts", "utf16le"), all: false, terminated: true }], signal), 128 + 32 + 16 + 14 + 32 + 10);
  const executor = new RegexExecutor();
  const controller = new AbortController();
  controller.abort(new Error("before glob admission"));
  assert.throws(() => executor.open(controller.signal), /before glob admission/u);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
