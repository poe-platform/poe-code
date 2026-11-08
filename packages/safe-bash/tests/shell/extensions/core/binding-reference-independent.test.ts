import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes, shellValueText } from "../../../../src/contracts/value.js";
import type { ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Runtime } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { ValueArena } from "../../../../src/shell/value-state.js";

function setup(execute: (command: ShellExtensionContext) => Promise<number>, arrays = true) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [
    ...(arrays ? [arraysExtension()] : []),
    { name: "reference-independent", create: () => ({ builtins: [{ name: "reference", execute }] }) },
  ] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

async function prepare(command: ShellExtensionContext, value: ShellValue) {
  const result = await command.bindings.prepareReference(value);
  if (!result.ok) assert.fail(shellValueText(result.diagnostic));
  return result.value;
}

for (const reason of [false, 0, "", null]) test(`queued reference publication honors cancellation ${JSON.stringify(reason)}`, async context => {
  const controller = new AbortController();
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    const publication = context.mock.method(Runtime.prototype, "assignVariable");
    try {
      const operation = reference.assignInteger(8);
      controller.abort(reason);
      await assert.rejects(operation, error => Object.is(error, reason));
      assert.equal(publication.mock.callCount(), 0);
      await reference.close();
    } finally { publication.mock.restore(); }
    return 0;
  });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("who=old; reference", { signal: controller.signal }), error => Object.is(error, reason));
});

test("reference busy admission refuses overlapping unset and recovers after settlement", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    const publication = reference.assignInteger(3);
    const overlap = reference.unbindName();
    await assert.rejects(overlap, /busy/u);
    assert.deepEqual(await publication, { ok: true, value: undefined });
    assert.equal(command.bindings.get("who"), "3");
    assert.deepEqual(await reference.unbindName(), { ok: true, value: undefined });
    assert.equal(command.bindings.get("who"), undefined);
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=old; reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("indexed whole-name unset admitted before close drains before close resolves", { timeout: 2000 }, async context => {
  const controls: { release?: () => void; entered?: () => void } = {};
  const shell = setup(async command => {
    const reference = await prepare(command, "values");
    const gate = new Promise<void>(resolve => { controls.release = resolve; });
    const entered = new Promise<void>(resolve => { controls.entered = resolve; });
    const original = Runtime.prototype.unsetIndexed;
    const unsetting = context.mock.method(Runtime.prototype, "unsetIndexed", async function (this: Runtime, ...args: Parameters<Runtime["unsetIndexed"]>) {
      controls.entered!();
      await gate;
      return original.apply(this, args);
    });
    const settlement = { closed: false };
    try {
      const operation = reference.unbindName();
      const closing = reference.close();
      void closing.then(() => { settlement.closed = true; });
      await entered;
      assert.equal(settlement.closed, false);
      assert.equal(command.bindings.get("values", 1), "right");
      await assert.rejects(reference.assignInteger(9), /closed/u);
      controls.release!();
      assert.deepEqual(await operation, { ok: true, value: undefined });
      await closing;
      assert.deepEqual(command.bindings.describe("values"), { kind: "unset", exported: false, readonly: false });
    } finally { controls.release?.(); unsetting.mock.restore(); }
    return 0;
  });
  context.after(() => { controls.release?.(); return shell.dispose(); });
  const result = await shell.exec("values=(left right); reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("local scalar early unset restores outer value and export provenance", async context => {
  const shell = setup(async command => {
    if (command.args[0] === "check") {
      assert.equal(command.bindings.get("who"), "outer");
      assert.equal(command.bindings.describe("who").exported, true);
      return 0;
    }
    assert.equal(command.bindings.get("who"), "inner");
    const reference = await prepare(command, "who");
    await reference.unbindName();
    await reference.assignInteger(23);
    assert.equal(command.bindings.get("who"), "23");
    assert.equal(command.bindings.describe("who").exported, false);
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("export who=outer; collect() { local who=inner; reference; }; collect; reference check");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("bracketed readonly full-name unset is a no-op but publication refuses", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    assert.deepEqual(await reference.unbindName(), { ok: true, value: undefined });
    assert.equal(command.bindings.describe("values").readonly, true);
    assert.equal(command.bindings.get("values", 1), "right");
    assert.deepEqual(await reference.assignInteger(9), { ok: false, diagnostic: "values: readonly variable" });
    assert.equal(command.bindings.get("values", 1), "right");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); readonly values; reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("subshell publication preserves parent indexed raw bytes and untouched child members", async context => {
  const left = Uint8Array.of(0xfe, 0x41);
  const right = Uint8Array.of(0xff, 0x42);
  const shell = setup(async command => {
    if (command.args[0] === "setup") {
      const writer = await command.bindings.openIndexed("values");
      try {
        await writer.set(0, shellValueFromBytes(left));
        await writer.set(1, shellValueFromBytes(right));
      } finally { await writer.close(); }
      return 0;
    }
    if (command.args[0] === "child") {
      const reference = await prepare(command, "values[1]");
      try { await reference.assignInteger(7); }
      finally { await reference.close(); }
      assert.equal(command.bindings.get("values", 1), "7");
    } else assert.deepEqual(shellValueBytes(command.bindings.get("values", 1)!), right);
    assert.deepEqual(shellValueBytes(command.bindings.get("values", 0)!), left);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("reference setup; (reference child); reference parent");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("OPTIND reference operations retain canonical getopts reset behavior without arrays", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "OPTIND");
    await reference.unbindName();
    await reference.assignInteger(1);
    await reference.close();
    return 0;
  }, false);
  context.after(() => shell.dispose());
  const result = await shell.exec("set -- -a -b; getopts ab first; reference; getopts ab second; printf '%s:%s:%s' \"$first\" \"$second\" \"$OPTIND\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "a:a:2");
});

test("handle reservation refusal releases prior reference holds and permits later preparation", async context => {
  const observed: { arena?: ValueArena } = {};
  const shell = setup(async command => {
    const original = ValueArena.prototype.allocate;
    const allocation = context.mock.method(ValueArena.prototype, "allocate", function (this: ValueArena, ...args: Parameters<ValueArena["allocate"]>) {
      observed.arena = this;
      return original.apply(this, args);
    });
    const first = await prepare(command, "who");
    await first.close();
    allocation.mock.restore();
    assert.ok(observed.arena);
    const baseline = { ...observed.arena.usage };
    const failure = new ShellLimitError("maxExpansionBytes");
    const refusing = context.mock.method(ValueArena.prototype, "allocate", function (this: ValueArena, ...args: Parameters<ValueArena["allocate"]>) {
      if (args[0] === 134) throw failure;
      return original.apply(this, args);
    });
    try { await assert.rejects(command.bindings.prepareReference("who"), error => error === failure); }
    finally { refusing.mock.restore(); }
    assert.deepEqual(observed.arena.usage, baseline);
    const next = await prepare(command, "who");
    await next.close();
    assert.deepEqual(observed.arena.usage, baseline);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("reference");
  assert.equal(result.exitCode, 0, result.stderr);
});
