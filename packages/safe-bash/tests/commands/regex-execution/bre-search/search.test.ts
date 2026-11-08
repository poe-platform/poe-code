import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../../src/commands/regex-execution/portable.js";
import { exprMatchCeilings } from "../../../../src/commands/regex-execution/protocol.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test("BRE search finds the leftmost longest match in original byte coordinates", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const [pattern, subject, overall] of [
      ["ab\\|a", "xxab", { start: 2, end: 4 }],
      ["^a", "ba", null],
      ["a$", "ba", { start: 1, end: 2 }],
      ["", "abc", { start: 0, end: 0 }],
      ["\\(ab\\)\\1", "xabab", { start: 1, end: 5 }],
      ["[[:digit:]]\\{1,3\\}", "x1234", { start: 1, end: 4 }],
    ] as const) {
      const result = await session.searchBre({ kind: "bre-search", pattern: bytes(pattern), profile: "byte", limits: exprMatchCeilings }, bytes(subject));
      assert.deepEqual({ ...result, steps: 0 }, { offsetUnit: "byte", matched: overall !== null, overall, steps: 0 }, pattern);
      assert.ok(result.steps > 0);
    }
  } finally { await session.close(); await executor.dispose(); }
});

test("BRE search uses GNU word/buffer assertions and nullable capture histories", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const [pattern, subject, matched] of [
      ["\\bcat\\b", "a cat!", true], ["\\<cat\\>", "cats", false],
      ["\\Bcat", "scat", true], ["\\`cat", "a cat", false],
      ["cat\\'", "a cat", true], ["\\w\\+\\s\\W", "abc !", true],
      ["\\(a*\\)*\\1", "a", true], ["\\(a*\\)*\\1b", "aaab", true],
      ["[z-a]", "a", false], ["a**", "aaa", true],
    ] as const) {
      const result = await session.searchBre({ kind: "bre-search", pattern: bytes(pattern), profile: "byte", limits: exprMatchCeilings }, bytes(subject));
      assert.equal(result.matched, matched, pattern);
    }
  } finally { await session.close(); await executor.dispose(); }
});

test("BRE search does not inherit portable expr's NUL/high-byte prohibition", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const [pattern, subject, profile, overall] of [
      [Uint8Array.of(255), Uint8Array.of(0, 255), "byte", { start: 1, end: 2 }],
      [bytes("."), Uint8Array.of(0, 255), "byte", { start: 1, end: 2 }],
      [Uint8Array.of(0), Uint8Array.of(255, 0), "byte", { start: 1, end: 2 }],
      [bytes("é"), bytes("xéz"), "utf8-scalar", { start: 1, end: 3 }],
    ] as const) {
      const result = await session.searchBre({ kind: "bre-search", pattern, profile, limits: exprMatchCeilings }, subject);
      assert.deepEqual(result.overall, overall);
    }
  } finally { await session.close(); await executor.dispose(); }
});

test("BRE search compiles full patterns on empty subjects before matching", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const pattern of ["a[", "\\1", "a\\{2,1\\}", "a\\"]) {
      await assert.rejects(async () => session.searchBre({ kind: "bre-search", pattern: bytes(pattern), profile: "byte", limits: exprMatchCeilings }, bytes("")), { category: "syntax" });
    }
  } finally { await session.close(); await executor.dispose(); }
});
