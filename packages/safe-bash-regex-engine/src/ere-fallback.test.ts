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
