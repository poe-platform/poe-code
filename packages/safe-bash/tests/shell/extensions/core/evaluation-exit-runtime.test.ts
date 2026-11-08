import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtension, ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function contains(error: unknown, wanted: unknown): boolean {
  return Object.is(error, wanted) || error instanceof AggregateError && error.errors.some(item => contains(item, wanted));
}

for (const primary of [undefined, false, null, 0, "", new Error("EXIT event failure")]) test(`callback EXIT failure retains primary and cleanup failure after unwind: ${String(primary)}`, { timeout: 2000 }, async context => {
  const cleanupFailure = new Error("owned cleanup failure");
  const events: string[] = [];
  let exits = 0, closes = 0;
  const extension: ShellExtension = { name: "completion-failures", create: () => ({
    builtins: [{ name: "probe", async execute(command) {
      command.registerCleanup(() => { closes++; events.push("cleanup"); throw cleanupFailure; });
      try { return await command.evaluate("callback"); }
      finally { events.push("unwind"); }
    } }],
    event(event) { if (event === "exit") { exits++; throw primary; } },
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension], limits: { maxWallClockMs: 1200 } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("callback() { exit 7; }; probe"), error => contains(error, primary) && contains(error, cleanupFailure));
  assert.equal(exits, 1);
  assert.equal(closes, 1);
  assert.deepEqual(events, ["unwind", "cleanup"]);
});

for (const hook of ["start", "command"] as const) test(`extension ${hook} evaluator exit unwinds its hook before frame cleanup`, { timeout: 2000 }, async context => {
  const events: string[] = [];
  let entered = false;
  const evaluate = async (command: ShellExtensionContext) => {
    if (entered) return;
    entered = true;
    command.registerCleanup(() => { events.push("cleanup"); });
    try { await command.evaluate("callback() { exit 7; }; callback"); }
    finally { events.push("unwind"); }
  };
  const extension: ShellExtension = { name: "hook-evaluation", create: () => ({
    builtins: [],
    ...(hook === "start" ? { start: evaluate } : { async event(event, command) { if (event === "command") await evaluate(command); } }),
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension], limits: { maxWallClockMs: 1200 } });
  context.after(() => shell.dispose());
  const result = await shell.exec(":");
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(events, ["unwind", "cleanup"]);
});

test("child frame cleanup completes before its enclosing parent evaluation returns", { timeout: 2000 }, async context => {
  const events: string[] = [];
  const extension: ShellExtension = { name: "child-lifetimes", create: () => ({
    builtins: ["outer", "inner"].map(name => ({ name, async execute(command: ShellExtensionContext) {
      command.registerCleanup(() => { events.push(`cleanup:${name}`); });
      try {
        const status = await command.evaluate(name === "outer" ? "(inner); printf child-done" : "callback");
        events.push(`return:${name}`);
        return status;
      } finally { events.push(`unwind:${name}`); }
    } })),
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension], limits: { maxWallClockMs: 1200 } });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const result = await shell.exec("callback() { exit 7; }; outer; printf after");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "child-doneafter");
  assert.equal(result.stderr, "");
  assert.deepEqual(events, ["unwind:inner", "cleanup:inner", "return:outer", "unwind:outer", "cleanup:outer"]);
});

for (const reason of [undefined, false, null, 0, ""]) test(`cached callback exit completion does not skip or replace cleanup failure ${String(reason)}`, { timeout: 2000 }, async context => {
  const events: string[] = [];
  const extension: ShellExtension = { name: "cached-completion", create: () => ({
    builtins: [{ name: "probe", async execute(command) {
      command.registerCleanup(() => { events.push("cleanup"); throw reason; });
      try { return await command.evaluate("callback"); }
      finally { events.push("unwind"); }
    } }],
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension], limits: { maxWallClockMs: 1200 } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("callback() { exit 7; }; probe"), error => contains(error, reason));
  assert.deepEqual(events, ["unwind", "cleanup"]);
});
