import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { matchEre } from "./ere/matcher.js";

for (const signal of [undefined, new AbortController().signal]) {
  test(`ERE yields every frozen-clock quantum, signal=${signal !== undefined}`, async context => {
    context.mock.method(performance, "now", () => 0);
    context.mock.method(Date, "now", () => 0);
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    for (let quantum = 0; quantum < 3; quantum++) {
      let observed = false;
      const host = setImmediate(() => { observed = true; });
      context.after(() => clearImmediate(host));
      ledger.chargeWork(16384, signal);
      const pending = ledger.checkpoint(signal);
      assert.ok(pending instanceof Promise);
      await pending;
      assert.equal(observed, true);
    }
  });
}

test("large ASCII captures yield repeatedly before completing without a signal", async context => {
  context.mock.method(performance, "now", () => 0);
  context.mock.method(Date, "now", () => 0);
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("([ab]+)c", ledger);
  let turns = 0;
  let host = setImmediate(function observe() {
    turns++;
    host = setImmediate(observe);
  });
  context.after(() => clearImmediate(host));
  const result = await matchEre(program, "a".repeat(20000) + "c", ledger);
  assert.equal(result.matched, true);
  assert.ok(turns >= 2, `observed ${turns} host turns`);
});
