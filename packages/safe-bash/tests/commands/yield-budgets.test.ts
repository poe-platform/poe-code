import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "../../src/contracts/index.js";
import { registerInternalYieldCheckpoint, registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { Session, settings as streamSettings } from "../../src/commands/stream-format/shared.js";
import { Budget as TableBudget, settings as tableSettings } from "../../src/commands/table-text/internal.js";
import { ColumnBudget } from "safe-bash-command-column/internal";
import { settings as columnSettings } from "safe-bash-command-column/options";
import { Budget as HexBudget, settings as hexSettings } from "safe-bash-command-hexdump/internal";
import { Budget as PrBudget, settings as prSettings } from "safe-bash-command-pr/internal";
import { Budget as EndingBudget, settings as endingSettings } from "safe-bash-line-ending-engine/internal";
import { Session as InspectionSession, settings as inspectionSettings } from "../../src/commands/stream-inspection/shared.js";
import { Budget as FactorBudget, settings as factorSettings } from "safe-bash-command-factor/internal";
import { Budget as CsplitBudget, settings as csplitSettings } from "safe-bash-command-csplit/internal";
import { Budget as TsortBudget, settings as tsortSettings } from "safe-bash-command-tsort/internal";
import { Budget as IconvBudget, settings as iconvSettings } from "safe-bash-command-iconv/internal";
import { SharedBudget as FileBudget, settings as fileSettings } from "safe-bash-command-file/shared";
import { Limits as SearchBudget } from "../../src/commands/search/shared.js";
import { Budget as ArchiveBudget, settings as archiveSettings, bounded } from "../../src/commands/archive/internal.js";
import { Budget as HtmlBudget } from "safe-bash-command-html-to-markdown/budget";
import { settings as htmlSettings } from "safe-bash-command-html-to-markdown/options";
import { Budget as DiffBudget } from "../../src/commands/diff-patch/shared.js";
import { ArrayLedger } from "../../src/shell/arrays/ledger.js";
import { stringCheckpoint } from "../../src/shell/string-operations.js";
import { NativeWork, limitsFor } from "../../../safe-bash-command-yq/src/native-work.js";
import { Budget as DuBudget } from "safe-bash-command-du/budget";
import { settings as duSettings } from "safe-bash-command-du/options";
import { WalkBudget } from "safe-bash-command-tree/io";
import { settings as treeSettings } from "safe-bash-command-tree/options";
import { Budget as SplitBudget } from "safe-bash-command-split/io";
import { settings as splitSettings } from "safe-bash-command-split/options";
import { createCommandArguments } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createDdCommand } from "../../../safe-bash-command-dd/src/index.js";
import { fmtCommand } from "../../../safe-bash-command-fmt/src/command.js";
import { createNumfmtCommand } from "../../../safe-bash-command-numfmt/src/index.js";
import { createShufCommand } from "../../../safe-bash-command-shuf/src/shuf.js";
import { records, readAllRecords } from "../../../safe-bash-command-shuf/src/input.js";
import { textCommands } from "../../src/commands/text.js";

const factories: readonly [string, (context: CommandContext) => () => void | Promise<void>][] = [
  ["stream", context => { const budget = new Session(context, streamSettings({})); return () => budget.step(4096); }],
  ["table", context => { const budget = new TableBudget(context, tableSettings({})); return async () => { for (let step = 0; step < 1024; step++) await budget.step(); }; }],
  ["column", context => { const budget = new ColumnBudget(context, columnSettings({})); return () => budget.work(2048); }],
  ["hexdump", context => { const budget = new HexBudget(context, hexSettings({}), context.signal, context.signal, { closed: false }); return async () => { budget.charge(4096); await budget.checkpointWork(); }; }],
  ["pr", context => { const budget = new PrBudget(context, prSettings({}), context.signal); return async () => { budget.charge(4096); await budget.checkpointWork(); }; }],
  ["line endings", context => { const budget = new EndingBudget(context, endingSettings({}), context.signal, context.signal, { closed: false }); return () => budget.step(1024); }],
  ["inspection", context => { const budget = new InspectionSession(context, inspectionSettings({})); return () => budget.step(4096); }],
  ["factor", context => { const budget = new FactorBudget(context, factorSettings({}), context.signal); return () => { budget.charge(1024); return budget.checkpointWork(); }; }],
  ["csplit", context => { const budget = new CsplitBudget(context, csplitSettings({})); return () => { budget.charge(4095); return budget.checkpointWork(); }; }],
  ["tsort", context => { const budget = new TsortBudget(context, tsortSettings({}), context.signal); return () => { budget.charge(4096); return budget.checkpointWork(); }; }],
  ["iconv", context => { const budget = new IconvBudget(context, iconvSettings({}), context.signal, context.signal, { closed: false }); return () => { budget.charge(4096); return budget.checkpointWork(); }; }],
  ["file", context => { const budget = new FileBudget(context, fileSettings({})); return async () => { for (let step = 0; step < 128; step++) await budget.step(); }; }],
  ["archive", context => { const budget = new ArchiveBudget(context, archiveSettings({})); return async () => { for (let step = 0; step < 128; step++) await budget.member(); }; }],
  ["html-to-markdown", context => { const budget = new HtmlBudget(context, htmlSettings({})); return () => { budget.work(4096); return budget.checkpoint(); }; }],
  ["diff", context => { const budget = new DiffBudget(context, {}); return () => { budget.step(4096); return budget.checkpoint(); }; }],
  ["arrays", context => { const budget = new ArrayLedger(Infinity, Infinity); return () => budget.checkpoint(context.signal, 128); }],
  ["strings", context => { const work = { remaining: Infinity, signal: context.signal, exhausted(): never { throw new Error("exhausted"); } }; return () => stringCheckpoint(work, 128); }],
  ["yq", context => { const budget = new NativeWork(context, limitsFor()); return () => budget.tick(1024); }],
];
const frozenFactories: typeof factories = [
  ...factories,
  ["search", context => { const budget = new SearchBudget(context, {}); return async () => { for (let step = 0; step < 2048; step++) { const pending = budget.tick(); if (pending) await pending; } }; }],
  ["du", context => { const budget = new DuBudget(context, duSettings({})); return async () => { for (let step = 0; step < 64; step++) await budget.fs(async () => undefined); }; }],
  ["tree", context => { const budget = new WalkBudget(context, treeSettings({})); return async () => { for (let step = 0; step < 64; step++) await budget.fs(async () => undefined); }; }],
  ["split", context => { const budget = new SplitBudget(splitSettings({}), context.signal); return () => budget.step(65536); }],
  ["archive input", context => { const source = (async function* () { for (let step = 0; step < 640; step++) yield new Uint8Array(); })(); const input = bounded(source, Infinity, context.signal, 1024)[Symbol.asyncIterator](); let first = true; return async () => { const count = first ? 129 : 128; first = false; for (let step = 0; step < count; step++) await input.next(); }; }],
];
for (const scheduler of ["setImmediate", "setTimeout"] as const) {
for (const [name, factory] of frozenFactories) {
  test(`${name} yields repeatedly and accepts later cancellation with a frozen clock (${scheduler})`, async t => {
    t.mock.method(performance, "now", () => 0);
    t.mock.method(Date, "now", () => 0);
    if (scheduler === "setTimeout") {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
      Object.defineProperty(globalThis, "setImmediate", { ...descriptor, value: undefined });
      t.after(() => Object.defineProperty(globalThis, "setImmediate", descriptor));
    }
    const hostTurn = (callback: () => void): void => {
      if (scheduler === "setImmediate") setImmediate(callback);
      else setTimeout(callback, 0);
    };
    const controller = new AbortController();
    const context = { args: [], signal: controller.signal, stdout: { async write() {} } } as unknown as CommandContext;
    const tick = factory(context);
    for (let index = 0; index < 3; index++) {
      let turnObserved = false;
      const pending = new Promise<void>(resolve => hostTurn(() => { turnObserved = true; resolve(); }));
      await tick();
      assert.equal(turnObserved, true, `quantum ${index + 1} must permit host work`);
      await pending;
    }
    const stopped = new Error("cancel after earlier quanta");
    hostTurn(() => controller.abort(stopped));
    await assert.rejects(Promise.resolve().then(tick), error => error === stopped);
  });

}
}

for (const [name, factory] of factories) {
  test(`${name} invokes each caller checkpoint once per quantum with a frozen clock`, async t => {
    t.mock.method(performance, "now", () => 0);
    t.mock.method(Date, "now", () => 0);
    const controller = new AbortController();
    let checkpoints = 0;
    registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
    const context = { args: [], signal: controller.signal, stdout: { async write() {} } } as unknown as CommandContext;
    const tick = factory(context);
    await tick();
    assert.equal(checkpoints, 1);
    await tick();
    assert.equal(checkpoints, 2);
  });
}

test("array synchronous checkpoints stop before every host-turn boundary", async t => {
  t.mock.method(performance, "now", () => 0);
  const ledger = new ArrayLedger(Infinity, Infinity);
  for (let quantum = 0; quantum < 3; quantum++) {
    assert.equal(ledger.tryCheckpointSync(undefined, 127), true);
    assert.equal(ledger.tryCheckpointSync(), false);
    await ledger.checkpoint();
  }
});

for (const [name, command, args, chunks] of [
  ["dd", createDdCommand(), ["bs=1", "status=none"], [Buffer.alloc(8)]],
  ["fmt", fmtCommand(), [], Array.from({ length: 256 }, () => Buffer.from("one\n"))],
  ["numfmt", createNumfmtCommand(), ["--to=iec"], [Buffer.from("1024\n".repeat(4096))]],
  ["shuf range", createShufCommand(), ["-i", "1-20000", "-n", "15000"], []],
  ["shuf repeat", createShufCommand(), ["-i", "1-10", "-r", "-n", "15000"], []],
  ["shuf input", createShufCommand(), [], [Buffer.from("x\n".repeat(25000))]],
  ["sort", textCommands().find(command => command.name === "sort")!, ["-u"], [Buffer.from(Array.from({ length: 4096 }, (_, index) => `${4096 - index}\n`).join(""))]],
] as const) {
  test(`${name} yields multiple host turns with frozen clocks`, async t => {
    t.mock.method(performance, "now", () => 0);
    t.mock.method(Date, "now", () => 0);
    let turns = 0;
    const immediate = globalThis.setImmediate;
    t.mock.method(globalThis, "setImmediate", (callback: () => void) => immediate(() => { turns++; callback(); }));
    const carrier = createCommandArguments(args);
    const result = await command.execute({
      command: command.name, args: carrier.args, argumentValues: carrier,
      cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: (async function* () { yield* chunks; })(),
      stdout: { async write() {} }, stderr: { async write() {} },
    });
    assert.equal(result.exitCode, 0);
    assert.ok(turns >= 3, `${name} must yield repeatedly, observed ${turns}`);
  });
}

for (const name of ["records", "readAllRecords"] as const) {
  test(`shuf ${name} yields at each input scanning quantum`, async t => {
    t.mock.method(performance, "now", () => 0);
    let turns = 0;
    const immediate = globalThis.setImmediate;
    t.mock.method(globalThis, "setImmediate", (callback: () => void) => immediate(() => { turns++; callback(); }));
    const source = (async function* () { yield Buffer.from("x\n".repeat(24576)); })();
    const signal = new AbortController().signal;
    if (name === "records") { for await (const _record of records(source, 10, Infinity, signal)) { /* drain */ } }
    else await readAllRecords(source, 10, Infinity, Infinity, signal, []);
    assert.equal(turns, 3);
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
