import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundedRegexProvider } from "./execution/bounded-provider.js";
import { RegexExecutor } from "./execution/portable.js";
import type { SearchDescriptor } from "./execution/protocol.js";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { prepareUtf8EreSubject } from "./ere/matcher.js";

const descriptor = (pattern: string): SearchDescriptor => ({
  kind: "rg", patterns: [pattern], fixed: false, case: "sensitive",
  whole: false, word: false, nullData: false,
});

for (const [pattern, input, expected] of [
  ["✓|FAIL", "check ✓", [{ start: 6, end: 9 }]],
  ["✓|FAIL", "FAIL", [{ start: 0, end: 4 }]],
  ["✓|FAIL", "pass", []],
  ["🦀+|FAIL", "🦊🦀🦀!FAIL", [{ start: 4, end: 12 }, { start: 13, end: 17 }]],
  ["(🦀.)+|FAIL", "!🦀✓🦀🦊", [{ start: 1, end: 16 }]],
  ["✓|.", "🦀✓", [{ start: 0, end: 4 }, { start: 4, end: 7 }]],
] as const) test(`bounded Unicode selection ${pattern} on ${input}`, async context => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  context.after(async () => { await session.close(); await executor.close(); });
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const all of [false, true]) {
      const rows = [{ bytes: new TextEncoder().encode(input), all, terminated: true }];
      assert.deepEqual(await session.run(descriptor(pattern), rows), [all ? expected : expected.slice(0, 1)]);
    }
  }
});

for (const fixed of [false, true]) test(`bounded ASCII case folding accepts Unicode subjects (fixed=${fixed})`, async context => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  context.after(async () => { await session.close(); await executor.close(); });
  const result = await session.run({ ...descriptor(fixed ? "commander" : "commander|FAIL"), fixed, case: "insensitive" },
    [{ bytes: new TextEncoder().encode("🦀 COMMANDER"), all: false, terminated: true }]);
  assert.deepEqual(result, [[{ start: 5, end: 14 }]]);
});

test("Unicode selection retains provider work limits", async context => {
  const executor = new RegexExecutor(createBoundedRegexProvider({ maxWork: 2000 }));
  const session = executor.open(new AbortController().signal);
  context.after(async () => { await session.close(); await executor.close(); });
  await assert.rejects(session.run(descriptor("🦀*🦀*🦀*z"),
    [{ bytes: new TextEncoder().encode("🦀".repeat(40)), all: false, terminated: true }]), /work/);
});

test("Unicode matching observes cancellation during bounded traversal", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("🦀*🦀*🦀*z", ledger, undefined, false, undefined, true);
  const controller = new AbortController();
  const matcher = await prepareUtf8EreSubject(new TextEncoder().encode("🦀".repeat(80)), ledger, controller.signal, true);
  const reason = new Error("cancel Unicode traversal");
  const timer = setImmediate(() => controller.abort(reason));
  try { await assert.rejects(matcher(program)(0), error => error === reason); }
  finally { clearImmediate(timer); }
});

test("Unicode compilation keeps the C/POSIX profile and byte ceilings separate", async () => {
  const bounds = { maxExpansionBytes: Infinity, maxExpansionFields: Infinity };
  await compileEre("✓|FAIL", new EreLedger(bounds), undefined, false, undefined, true);
  await assert.rejects(compileEre("✓|FAIL", new EreLedger(bounds)), /C\/POSIX/);
  await assert.rejects(compileEre("🦀|a", new EreLedger(bounds, { patternBytes: 5 }), undefined, false, undefined, true), /patternBytes/);
  await assert.rejects(compileEre([{ text: "🦀", literal: true }, { text: "|a", literal: false }],
    new EreLedger(bounds, { patternBytes: 5 }), undefined, false, undefined, true), /patternBytes/);
});
