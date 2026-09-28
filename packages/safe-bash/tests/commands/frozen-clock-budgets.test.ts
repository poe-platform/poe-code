import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "../../src/contracts/index.js";
import { Budget as FactorBudget, settings as factorSettings } from "safe-bash-command-factor/internal";
import { Budget as CsplitBudget, settings as csplitSettings } from "safe-bash-command-csplit/internal";
import { Limits as SearchBudget } from "../../src/commands/search/shared.js";
import { ArrayLedger } from "../../src/shell/arrays/ledger.js";
import { EreLedger } from "../../../safe-bash-regex-engine/src/ere/limits.js";
import { NativeWork, limitsFor } from "../../../safe-bash-command-yq/src/native-work.js";

const factories: readonly [string, (context: CommandContext) => () => void | Promise<void>][] = [
  ["factor", context => { const budget = new FactorBudget(context, factorSettings({}), context.signal); return () => { budget.charge(1024); return budget.checkpointWork(); }; }],
  ["csplit", context => { const budget = new CsplitBudget(context, csplitSettings({})); return () => { budget.charge(4096); return budget.checkpointWork(); }; }],
  ["search", context => { const budget = new SearchBudget(context, {}); return async () => { for (let i = 0; i < 2048; i++) { const pending = budget.tick(); if (pending) await pending; } }; }],
  ["ERE with signal", context => { const budget = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }); return () => { budget.chargeWork(16384, context.signal); return budget.checkpoint(context.signal); }; }],
  ["ERE without signal", () => { const budget = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }); return () => { budget.chargeWork(16384); return budget.checkpoint(); }; }],
  ["arrays", context => { const budget = new ArrayLedger(Infinity, Infinity); return () => budget.checkpoint(context.signal, 128); }],
  ["yq", context => { const budget = new NativeWork(context, limitsFor()); return () => budget.tick(8192); }],
];
for (const clock of [0, 123]) {
  for (const [name, factory] of factories) {
    test(`${name} permits repeated host turns with clock frozen at ${clock}`, async t => {
      t.mock.method(performance, "now", () => clock);
      const context = { args: [], signal: new AbortController().signal } as unknown as CommandContext;
      const tick = factory(context);
      for (let quantum = 0; quantum < 3; quantum++) {
        let observed = false;
        const pending = new Promise<void>(resolve => setImmediate(() => { observed = true; resolve(); }));
        await tick();
        const yielded = observed;
        await pending;
        assert.equal(yielded, true, `quantum ${quantum + 1} must permit host work`);
      }
    });
  }
  test(`array synchronous fast path defers at its work quantum with clock ${clock}`, t => {
    t.mock.method(performance, "now", () => clock);
    const budget = new ArrayLedger(Infinity, Infinity);
    assert.equal(budget.tryCheckpointSync(undefined, 127), true);
    assert.equal(budget.tryCheckpointSync(undefined, 1), false);
  });
}

for (const [name, factory] of factories.filter(([name]) => name !== "ERE without signal")) {
  test(`${name} observes timer cancellation after earlier yields in a timer-only host`, async t => {
    t.mock.method(performance, "now", () => 0);
    const immediate = globalThis.setImmediate;
    Reflect.set(globalThis, "setImmediate", undefined);
    try {
      const controller = new AbortController();
      const context = { args: [], signal: controller.signal } as unknown as CommandContext;
      const tick = factory(context);
      await tick();
      await tick();
      const stopped = new Error("timer cancellation");
      const timer = setTimeout(() => controller.abort(stopped), 0);
      try { await assert.rejects(Promise.resolve().then(tick), error => error === stopped); }
      finally { clearTimeout(timer); }
    } finally { Reflect.set(globalThis, "setImmediate", immediate); }
  });
}
