import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { defaults, type Reply } from "../../../src/commands/regex-execution/protocol.js";
import { EreLedger } from "../../../src/commands/regex-execution/ere/limits.js";
import { compileEre } from "../../../src/commands/regex-execution/ere/syntax.js";
import { matchEre, prepareUtf8EreSubject } from "../../../src/commands/regex-execution/ere/matcher.js";

async function search(patterns: string[], bytes: Uint8Array, all = true): Promise<Reply> {
  const worker = createBoundedRegexProvider().createWorker(defaults);
  try {
    return await new Promise<Reply>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", value => {
        if (value && typeof value === "object" && "id" in value) resolve(value as Reply);
      });
      worker.postMessage({ id: 1, descriptor: { kind: "grep", patterns, fixed: false, extended: true, insensitive: false, whole: false, word: false }, rows: [{ bytes, all, terminated: true }] });
    });
  } finally { await worker.terminate(); }
}

for (const [label, pattern, subject, expected] of [
  ["astral and combining scalars", ".", "é🦊e\u0301", [0, 2, 2, 6, 6, 7, 7, 9]],
  ["BOM identity", ".", "\ufeffa", [0, 3, 3, 4]],
  ["negated ASCII class", "[^a]+", "aé🦊a", [1, 7]],
  ["negated named class", "[^[:alpha:]]+", "aé🦊z", [1, 7]],
  ["positive named class remains ASCII", "[[:alpha:]]+", "éa🦊Z", [2, 3, 7, 8]],
  ["original end anchor", "a$", "🦊a", [4, 5]],
  ["empty advances a scalar", "a*", "🦊a", [0, 0, 4, 5, 5, 5]],
  ["repetition counts scalars", "^.{2}$", "é🦊", [0, 6]],
  ["no Unicode normalization", "e", "ée\u0301", [2, 3]],
] as const) {
  test(`UTF-8 subject review: ${label}`, async () => {
    const reply = await search([pattern], new TextEncoder().encode(subject));
    assert.ok("results" in reply, "error" in reply ? reply.error : "missing results");
    assert.deepEqual(reply.results.map(ranges => [...ranges]), [expected]);
  });
}

test("UTF-8 global candidate invalidation retains original byte offsets", async () => {
  const reply = await search(["ab", "b..b"], new TextEncoder().encode("éab🦊xbxxb"));
  assert.ok("results" in reply);
  assert.deepEqual(reply.results.map(ranges => [...ranges]), [[2, 4, 9, 13]]);
});

test("UTF-8 validation precedes empty or absent-pattern selection", async () => {
  for (const bytes of [Uint8Array.of(0xc0, 0x80), Uint8Array.of(0xed, 0xa0, 0x80), Uint8Array.of(0xf4, 0x90, 0x80, 0x80), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0), Uint8Array.of(0x80)]) {
    for (const patterns of [[""], ["absent"], []]) {
      const reply = await search(patterns, bytes, false);
      assert.ok("error" in reply);
      assert.match(reply.error, /UTF-8|NUL|ASCII/);
    }
  }
});

test("ordinary ERE capture matcher retains its ASCII subject profile", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const program = await compileEre("(.)", ledger);
  await assert.rejects(matchEre(program, "🦊", ledger));
  assert.deepEqual((await matchEre(program, "a", ledger)).values, ["a", "a"]);
});

test("prepared UTF-8 subject owns bytes and authenticates ledger-bound programs and cursors", async () => {
  const bounds = { maxExpansionBytes: 65536, maxExpansionFields: 8192 };
  const ledger = new EreLedger(bounds);
  const bytes = new TextEncoder().encode("é🦊a");
  const prepared = await prepareUtf8EreSubject(bytes, ledger);
  bytes.fill(97);
  const program = await compileEre(".", ledger);
  const programFromOtherLedger = await compileEre(".", new EreLedger(bounds));
  assert.throws(() => prepared({ ...program }));
  assert.throws(() => prepared(programFromOtherLedger));
  const scan = prepared(program);
  for (const cursor of [1, 3, 4, 5, -1, 8, NaN, 0.5]) await assert.rejects(scan(cursor), RangeError);
  assert.deepEqual(await scan(2), { start: 2, end: 6 });
  assert.deepEqual(await scan(6), { start: 6, end: 7 });
  assert.equal(await scan(7), undefined);
  assert.equal(ledger.usage.captureBytes, 0);
});
