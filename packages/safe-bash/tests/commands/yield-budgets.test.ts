import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "../../src/contracts/index.js";
import { registerInternalYieldCheckpoint, registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { Session, settings as streamSettings } from "../../src/commands/stream-format/shared.js";
import { Budget as TableBudget, settings as tableSettings } from "../../src/commands/table-text/internal.js";
import { ColumnBudget } from "../../src/commands/column/internal.js";
import { settings as columnSettings } from "../../src/commands/column/options.js";
import { Budget as HexBudget, settings as hexSettings } from "../../src/commands/hexdump/internal.js";
import { Budget as PrBudget, settings as prSettings } from "../../src/commands/pr/internal.js";
import { Budget as EndingBudget, settings as endingSettings } from "../../src/commands/line-endings/internal.js";

const factories: readonly [string, (context: CommandContext) => () => void | Promise<void>][] = [
  ["stream", context => { const budget = new Session(context, streamSettings({})); return () => budget.step(4096); }],
  ["table", context => { const budget = new TableBudget(context, tableSettings({})); return async () => { for (let step = 0; step < 1024; step++) await budget.step(); }; }],
  ["column", context => { const budget = new ColumnBudget(context, columnSettings({})); return () => budget.work(2048); }],
  ["hexdump", context => { const budget = new HexBudget(context, hexSettings({}), context.signal, context.signal, { closed: false }); return async () => { budget.charge(4096); await budget.checkpointWork(); }; }],
  ["pr", context => { const budget = new PrBudget(context, prSettings({}), new AbortController().signal); return async () => { budget.charge(4096); await budget.checkpointWork(); }; }],
  ["line endings", context => { const budget = new EndingBudget(context, endingSettings({}), context.signal, context.signal, { closed: false }); return () => budget.step(1024); }],
];
for (const [name, factory] of factories) {
  test(`${name} yields on elapsed time and caller checkpoints`, async t => {
    let now = 0, turns = 0;
    const immediate = globalThis.setImmediate;
    t.mock.method(performance, "now", () => now);
    t.mock.method(globalThis, "setImmediate", (callback: () => void) => { turns++; return immediate(callback); });
    const controller = new AbortController();
    const context = { args: [], signal: controller.signal, stdout: { async write() {} } } as unknown as CommandContext;
    const tick = factory(context);
    for (let index = 0; index < 10; index++) await tick();
    assert.equal(turns, 0);
    now = 26;
    await tick();
    assert.equal(turns, 1);
    // Register before creating child signals so inheritance is exercised.
    let checkpoints = 0;
    registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
    const checkpointTick = factory(context);
    await checkpointTick();
    assert.equal(checkpoints, 1);
    assert.equal(turns, 2);
  });
}

for (const [name, factory] of factories.filter(([name]) => name === "column" || name === "hexdump")) {
  test(`${name} observes cancellation from an internal checkpoint before a timed turn`, async t => {
    t.mock.method(performance, "now", () => 0);
    const controller = new AbortController();
    const stopped = new Error("internal checkpoint stopped command");
    registerInternalYieldCheckpoint(controller.signal, () => controller.abort(stopped));
    const context = { args: [], signal: controller.signal, stdout: { async write() {} } } as unknown as CommandContext;
    const tick = factory(context);
    await assert.rejects(Promise.resolve().then(tick), error => error === stopped);
  });
}
