import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../../../src/commands/regex-execution/matching.js";
import type { GrepDescriptor, SearchDescriptor } from "../../../src/commands/regex-execution/protocol.js";

const grep: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: true, extended: false, insensitive: false, whole: false, word: false };
const search: SearchDescriptor = { kind: "rg", patterns: ["a"], fixed: true, case: "sensitive", whole: false, word: false, nullData: false };

for (const fixture of [
  { name: "one pattern", patterns: ["a"], exact: "a".repeat(100_000), overflow: "a".repeat(100_001) },
  { name: "multiple patterns", patterns: ["a", "b"], exact: "a".repeat(50_000) + "b".repeat(50_000), overflow: "a".repeat(50_000) + "b".repeat(50_001) },
  { name: "duplicate patterns", patterns: ["a", "a"], exact: "a".repeat(50_000), overflow: "a".repeat(50_001) },
  { name: "overlapping patterns", patterns: ["a", "aa"], exact: "a".repeat(66_667), overflow: "a".repeat(66_668) },
  { name: "zero-length matches", patterns: [""], exact: "a".repeat(99_999), overflow: "a".repeat(100_000) },
]) {
  test(`grep admits exactly 100000 raw ranges from ${fixture.name}`, () => {
    const matcher = compile({ ...grep, patterns: fixture.patterns });
    assert.equal(matcher({ bytes: Buffer.from(fixture.exact), all: true, terminated: true }, 0).length, 100_000);
  });
  test(`grep admits ranges above the former cap from ${fixture.name}`, () => {
    const matcher = compile({ ...grep, patterns: fixture.patterns });
    assert.ok(matcher({ bytes: Buffer.from(fixture.overflow), all: true, terminated: true }, 0).length > 100_000);
  });
}

test("grep range observation detects ordinary range construction", () => {
  const matcher = compile(grep);
  const originalExec = RegExp.prototype.exec;
  let indexReads = 0;
  RegExp.prototype.exec = function (text) {
    const result = originalExec.call(this, text);
    if (result) Object.defineProperty(result, "index", { get() { indexReads++; return 0; } });
    return result;
  };
  try { assert.deepEqual(matcher({ bytes: Buffer.from("a"), all: true, terminated: true }, 0), [{ start: 0, end: 1 }]); }
  finally { RegExp.prototype.exec = originalExec; }
  assert.equal(indexReads, 2);
});

test("grep per-row admission resets after both success and failure", () => {
  const matcher = compile(grep);
  const row = { bytes: Buffer.alloc(100_000, 97), all: true, terminated: true };
  assert.equal(matcher(row, 0).length, 100_000);
  assert.equal(matcher(row, 1).length, 100_000);
  assert.equal(matcher({ ...row, bytes: Buffer.alloc(100_001, 97) }, 2).length, 100_001);
  assert.deepEqual(matcher({ ...row, bytes: Buffer.from("a") }, 3), [{ start: 0, end: 1 }]);
});

test("grep non-all retains first accepted match in pattern order", () => {
  const row = { bytes: Buffer.from("ab".repeat(100_001)), all: false, terminated: true };
  assert.deepEqual(compile({ ...grep, patterns: ["b", "a"] })(row, 0), [{ start: 1, end: 2 }]);
  assert.deepEqual(compile({ ...grep, patterns: [""] })(row, 0), [{ start: 0, end: 0 }]);
});

test("grep word rejection does not consume range admission", () => {
  const matcher = compile({ ...grep, word: true });
  const bytes = Buffer.from("a".repeat(100_001) + " a!");
  assert.deepEqual(matcher({ bytes, all: true, terminated: true }, 0), [{ start: 100_002, end: 100_003 }]);
  assert.deepEqual(matcher({ bytes, all: false, terminated: true }, 0), [{ start: 100_002, end: 100_003 }]);
});

test("grep preserves sorting, duplicate candidates, raw bytes and unterminated empty matches", () => {
  assert.deepEqual(compile({ ...grep, patterns: ["a", "aa", "a"] })({ bytes: Buffer.from("aa"), all: true, terminated: true }, 0), [
    { start: 0, end: 2 }, { start: 0, end: 1 }, { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 1, end: 2 },
  ]);
  assert.deepEqual(compile({ ...grep, patterns: ["."], fixed: false, extended: true })({ bytes: Buffer.from([255, 0, 254]), all: true, terminated: false }, 0), [
    { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 },
  ]);
  assert.deepEqual(compile({ ...grep, patterns: [""] })({ bytes: Buffer.from("a"), all: true, terminated: false }, 0), [{ start: 0, end: 0 }, { start: 1, end: 1 }]);
});

for (const patterns of [["a"], [""]]) test(`rg retains exact range boundary for ${JSON.stringify(patterns)}`, () => {
  const matcher = compile({ ...search, patterns });
  const length = patterns[0] === "" ? 99_999 : 100_000;
  assert.equal(matcher({ bytes: Buffer.alloc(length, 97), all: true, terminated: true }, 0).length, 100_000);
  assert.equal(matcher({ bytes: Buffer.alloc(length + 1, 97), all: true, terminated: true }, 0).length, 100_001);
});

test("rg skips suppressed zero-length candidates without consuming admission", () => {
  const matcher = compile({ ...search, patterns: ["a*"], fixed: false });
  assert.equal(matcher({ bytes: Buffer.from("ab".repeat(99_999)), all: true, terminated: true }, 0).length, 100_000);
  assert.deepEqual(matcher({ bytes: Buffer.from("ab"), all: true, terminated: true }, 0), [{ start: 0, end: 1 }, { start: 2, end: 2 }]);
});
