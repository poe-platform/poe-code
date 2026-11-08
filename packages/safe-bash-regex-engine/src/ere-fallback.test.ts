import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { matchEre, tryMatchEreSync } from "./ere/matcher.js";

for (const remaining of [0, 1, 16, 32, 64, 128]) {
  test(`ERE fallback preserves work and charges result captures once with ${remaining} work remaining`, async () => {
    const ledger = new EreLedger({ maxExpansionBytes: 7, maxExpansionFields: 3 });
    const program = await compileEre("(a+)([0-9])b", ledger);
    ledger.chargeWork(16384 - ledger.usage.work - remaining);
    const before = ledger.usage.work;
    const synchronous = tryMatchEreSync(program, "aa1b", ledger);
    const afterProbe = ledger.usage.work;
    assert.ok(afterProbe >= before, "completed speculative work must not be refunded");
    if (remaining <= 32) assert.equal(synchronous, undefined);
    const result = synchronous ?? await matchEre(program, "aa1b", ledger);
    assert.deepEqual(result.values, ["aa1b", "aa", "1"]);
    assert.equal(ledger.usage.captureSlots, 3);
    assert.equal(ledger.usage.captureBytes, 7);
    assert.ok(ledger.usage.work > afterProbe || synchronous !== undefined);
  });
}

for (const [pattern, subject, precharges] of [
  ['(a+)([0-9])b', 'a'.repeat(200) + '1b', [0, 15800, 16000]],
  ['(a+)([0-9])b', 'aa1b', [0, 16340, 16360]],
  ['(a+)([0-9])b', 'z'.repeat(900) + 'a1b', [0, 14500]],
  ['(a+)([0-9])b', 'z'.repeat(900), [0, 14500]],
] as const) {
  test(`linear ERE continues without replay: subject length ${subject.length}`, async () => {
    const usages = [];
    const results = [];
    for (const precharge of precharges) {
      const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
      const program = await compileEre(pattern, ledger);
      ledger.chargeWork(precharge);
      const before = ledger.usage;
      const sync = tryMatchEreSync(program, subject, ledger);
      results.push(sync ?? await matchEre(program, subject, ledger));
      const after = ledger.usage;
      usages.push(Object.fromEntries(Object.keys(after).map(key => [key, after[key as keyof typeof after] - before[key as keyof typeof before]])));
    }
    for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
    for (const usage of usages.slice(1)) assert.deepEqual(usage, usages[0]);
  });
}

test('a suspended linear match preserves cancellation identity without more scanning', async () => {
  const controller = new AbortController();
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre('(a+)([0-9])b', ledger);
  ledger.chargeWork(15800);
  const subject = 'a'.repeat(200) + '1b';
  assert.equal(tryMatchEreSync(program, subject, ledger, controller.signal), undefined);
  const before = ledger.usage;
  const reason = new Error('cancel suspended scan');
  controller.abort(reason);
  await assert.rejects(matchEre(program, subject, ledger, controller.signal), error => error === reason);
  assert.deepEqual(ledger.usage, before);
});

test('linear continuation fails a work ceiling rather than yielding forever', async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, { work: 500 });
  const program = await compileEre('(a+)([0-9])b', ledger);
  const subject = 'a'.repeat(200) + '1b';
  await assert.rejects(matchEre(program, subject, ledger), /work/);
});
