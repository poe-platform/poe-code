import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { IndexedBinding } from "../../../../src/shell/arrays/bindings.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>, maxExpansionBytes?: number) {
  const shell = new Shell({ fs: createMemoryFileSystem(), ...(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } }), extensions: [{ name: "bindings", create: () => ({ builtins: [{ name: "operate", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

test("canonical scalar access and assignment preserve indexed zero and raw bytes", async context => {
  const shell = setup(async command => {
    assert.deepEqual(command.bindings.describe("a"), { kind: "indexed", readonly: false, exported: false });
    const value = command.bindings.get("a", 2)!;
    assert.equal(Buffer.from(shellValueBytes(value)).toString("hex"), "ff");
    await command.bindings.assign("scalar", value);
    await command.bindings.assign("a", value);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=([2]=$'\\xff'); operate; printf '%s' "$scalar" "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ffffff");
});

test("indexed transaction stages, clears, removes, commits and retires existing cells", async context => {
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed", clear: true });
    try {
      await transaction.set(2, command.argumentValues[0]!);
      await transaction.set(7, "discard");
      await transaction.unset(7);
      assert.equal(command.bindings.get("a"), "old");
      assert.equal(Buffer.from(shellValueBytes(transaction.get(2)!)).toString("hex"), "ff");
      await transaction.commit();
      await assert.rejects(transaction.set(0, "late"));
    } finally { await transaction.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(old tail); operate $'\\xff'; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cff3e");
});

test("preparation promotes a canonical scalar without copying decoded text", async context => {
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    await transaction.set(3, "tail");
    await transaction.commit();
    await transaction.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=$'\\xff'; operate; printf '%s' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff7461696c");
});

for (const mutation of ["a=(inner)", "readonly a"]) test(`transaction rejects changed binding: ${mutation}`, async context => {
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    await transaction.set(0, "outer");
    await command.evaluate(mutation);
    await assert.rejects(transaction.commit(), /changed|readonly/u);
    await transaction.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(old); operate; printf '%s' "$a"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, mutation.startsWith("readonly") ? "old" : "inner");
  assert.equal(result.stderr, "");
});

test("readonly guards reject assignment and preparation before publication", async context => {
  const shell = setup(async command => {
    assert.equal(command.bindings.describe("a").readonly, true);
    await assert.rejects(command.bindings.assign("a", "bad"), /readonly/u);
    await assert.rejects(command.bindings.prepare("a", { kind: "indexed" }), /readonly/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=old; readonly a; operate; printf '%s' \"$a\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "old");
  assert.equal(result.stderr, "");
});

test("extension preparation preserves existing control and export restrictions", async context => {
  const shell = setup(async command => {
    await assert.rejects(command.bindings.prepare("IFS", { kind: "indexed" }), /control binding/u);
    await assert.rejects(command.bindings.prepare("a", { kind: "indexed" }), /exported binding/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=old; export a; operate");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("local restoration and scoped admission survive committed and abandoned transactions", async context => {
  let saved: ShellExtensionContext | undefined;
  const shell = setup(async command => {
    saved = command;
    const abandoned = await command.bindings.prepare("unused", { kind: "indexed" });
    await abandoned.set(0, shellValueFromBytes(Uint8Array.of(254)));
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    await transaction.set(0, shellValueFromBytes(Uint8Array.of(255)));
    await transaction.commit();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(outer); f() { local a=inner; operate; printf '%s' "$a"; }; f; printf '%s' "$a" "\${unused-unset}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff6f75746572756e736574");
  assert.throws(() => saved!.bindings.get("a"), /closed/u);
  await assert.rejects(saved!.bindings.assign("a", "late"), /closed/u);
});

test("indexed extension writes enforce the existing shared byte budget", async context => {
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    await assert.rejects(transaction.set(0, shellValueFromBytes(new Uint8Array(32768).fill(255))), /capacity|limit/u);
    await transaction.close();
    return 0;
  }, 8192);
  context.after(() => shell.dispose());
  const result = await shell.exec("a=old; operate; printf '%s' \"$a\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "old");
  assert.equal(result.stderr, "");
});

test("transaction close drains an admitted write without publishing it", async context => {
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    const writing = transaction.set(0, command.argumentValues[0]!);
    const closing = transaction.close();
    await assert.rejects(writing, /closed/u);
    await closing;
    assert.equal(command.bindings.get("a"), "old");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=old; operate $'\\xff'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("root cancellation waits for admitted binding preparation to retire", { timeout: 2000 }, async context => {
  let signalEntered!: () => void;
  let releaseCopy!: () => void;
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const release = new Promise<void>(resolve => { releaseCopy = resolve; });
  const copy = IndexedBinding.prototype.copy;
  let retired = false;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    signalEntered();
    await release;
    try { return await copy.call(this, signal); }
    finally { retired = true; }
  });
  const controller = new AbortController();
  const shell = setup(async command => {
    await command.bindings.prepare("a", { kind: "indexed" });
    return 0;
  });
  context.after(() => shell.dispose());
  const operation = shell.exec("a=(old); operate", { signal: controller.signal });
  let settled = false;
  const rejection = assert.rejects(operation, error => Object.is(error, 0)).finally(() => { settled = true; });
  await entered;
  controller.abort(0);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  releaseCopy();
  await rejection;
  assert.equal(retired, true);
});

for (const reason of [false, 0, "", null]) test(`binding cancellation retains falsey reason ${String(reason)}`, async context => {
  const controller = new AbortController();
  const shell = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    await transaction.set(0, command.argumentValues[0]!);
    controller.abort(reason);
    await transaction.commit();
    return 0;
  });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(`operate $'\\xff'`, { signal: controller.signal }), error => Object.is(error, reason));
});
