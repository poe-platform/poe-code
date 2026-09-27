import assert from "node:assert/strict";
import test from "node:test";
import type { YqOwnedWork } from "safe-bash-query-engine";
import { YqLedger } from "./accounting.js";
import { parseYamlDocuments } from "./parser.js";

test("plain scalar waits for its inline scan without charging or parsing it twice", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const charges: number[] = [], values: unknown[] = [];
  const ledger = new YqLedger();
  const work: YqOwnedWork = {
    async charge() {},
    chargeSync(units = 1) {
      charges.push(units);
      if (charges.length === 2) { enter(); return gate; }
      return undefined;
    },
    admitInputBytes() {}, admitOutputBytes() {}, admitResult() {}, assertOpen() {},
    async measure() { return 0; }, async stringifyJson() { return ""; },
    reserve() { throw new Error("unexpected reservation"); }
  };
  const parsing = (async () => {
    for await (const value of parseYamlDocuments("word", work, ledger)) values.push(value);
  })();
  await entered;
  await new Promise<void>(resolve => { setImmediate(resolve); });
  try {
    assert.deepEqual(charges, [4, 4]);
    assert.equal(ledger.documentNodes, 0);
    assert.deepEqual(values, []);
  } finally { release(); await parsing; }
  assert.deepEqual(charges, [4, 4, 6]);
  assert.deepEqual(values, ["word"]);
});

for (const reason of [false, null, new Error("inline scan failed")]) {
  test(`plain scalar preserves an inline scan rejection: ${String(reason)}`, async () => {
    let scans = 0;
    const ledger = new YqLedger();
    const values: unknown[] = [];
    const work: YqOwnedWork = {
      async charge() {},
      chargeSync() { if (++scans === 2) return Promise.reject(reason); return undefined; },
      admitInputBytes() {}, admitOutputBytes() {}, admitResult() {}, assertOpen() {},
      async measure() { return 0; }, async stringifyJson() { return ""; },
      reserve() { throw new Error("unexpected reservation"); }
    };
    await assert.rejects(async () => {
      for await (const value of parseYamlDocuments("word", work, ledger)) values.push(value);
    }, error => error === reason);
    assert.equal(scans, 2);
    assert.equal(ledger.documentNodes, 0);
    assert.deepEqual(values, []);
  });
}
