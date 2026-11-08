import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { IndexedBinding } from "../../../../src/shell/arrays/bindings.js";
import type { ShellExtensionContext, ShellIndexedWriter } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>, maxExpansionBytes?: number) {
  const shell = new Shell({
    fs: createMemoryFileSystem(),
    ...(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } }),
    extensions: [{ name: "writer-review", create: () => ({ builtins: [{ name: "records", execute }] }) }],
  });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const origin of [2147483648, 4294967295]) {
  const next = origin === 4294967295 ? 0 : origin + 1;
  const expectedAll = origin === 4294967295 ? "3cfe3e3cff3e" : "3cff3e3cfe3e";
  for (const consumer of ["binding", "element", "members"] as const) {
    test(`uint32 writer records round-trip through ${consumer}: origin ${origin}`, async context => {
      const shell = setup(async command => {
        const writer = await command.bindings.openIndexed("a", { clear: true });
        try {
          await writer.set(origin, shellValueFromBytes(Uint8Array.of(255)));
          await writer.set(next, shellValueFromBytes(Uint8Array.of(254)));
          if (consumer === "binding") {
            assert.deepEqual(shellValueBytes(command.bindings.get("a", origin)!), Uint8Array.of(255));
            assert.deepEqual(shellValueBytes(command.bindings.get("a", next)!), Uint8Array.of(254));
          }
        } finally { await writer.close(); }
        return 0;
      });
      context.after(() => shell.dispose());
      const source = consumer === "element" ? `records; printf '<%s>' "\${a[${origin}]}" "\${a[${next}]}"`
        : consumer === "members" ? 'records; printf \'<%s>\' "${a[@]}"' : "records";
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), consumer === "element" ? "3cff3e3cfe3e" : consumer === "members" ? expectedAll : "");
    });
  }

  test(`native mapfile uint32 origin reads the written cells and preserves member order: ${origin}`, nativeOptions(), () => {
    const source = `printf '\\377\\n\\376\\n' | { mapfile -t -O${origin} a; printf '<%s>' "\${a[${origin}]}" "\${a[${next}]}" "\${a[@]}"; }`;
    const result = runNative(source);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.toString("hex"), `3cff3e3cfe3e${expectedAll}`);
  });
}

test("invocation cleanup closes an abandoned writer while preserving published records", async context => {
  let escaped!: ShellIndexedWriter;
  const shell = setup(async command => {
    escaped = await command.bindings.openIndexed("a", { clear: true });
    await escaped.set(0, shellValueFromBytes(Uint8Array.of(255)));
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "%s" "$a"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
  const closing = escaped.close();
  assert.equal(escaped.close(), closing);
  await closing;
  await assert.rejects(escaped.set(1, "escaped"), /closed/u);
});

test("two admitted writers follow each other's publications without losing cells", async context => {
  const shell = setup(async command => {
    const first = await command.bindings.openIndexed("a", { clear: true });
    const second = await command.bindings.openIndexed("a");
    try {
      await first.set(0, "first");
      await second.set(1, "second");
      assert.equal(await command.evaluate("a=(callback)"), 0);
      await first.set(2, "third");
      await second.set(3, "fourth");
    } finally { await first.close(); await second.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "<%s>" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<callback><third><fourth>");
});

for (const readonly of [false, true]) test(`an outer writer cannot mutate a local shadow but can resume after restoration: readonly=${readonly}`, async context => {
  let outer: ShellIndexedWriter | undefined;
  const shell = setup(async command => {
    if (command.args[0] === "shadow") {
      assert.equal(command.bindings.describe("a").readonly, readonly);
      await assert.rejects(outer!.set(1, "leaked"), /identity|target/u);
      return 0;
    }
    outer = await command.bindings.openIndexed("a");
    try {
      await outer.set(0, shellValueFromBytes(Uint8Array.of(255)));
      assert.equal(await command.evaluate(`f() { local a=inner; ${readonly ? "readonly a; " : ""}records shadow; printf "<%s>" "$a"; }; f`), 0);
      await outer.set(1, "tail");
    } finally { await outer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('a=(outer); records; printf "%s" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3c696e6e65723eff7461696c");
});

test("failed record admission leaves earlier transactions valid and preserves the overwritten raw cell", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    await writer.set(0, shellValueFromBytes(Uint8Array.of(255)));
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    try {
      await transaction.set(1, "accepted");
      await assert.rejects(writer.set(0, shellValueFromBytes(new Uint8Array(65536))), /capacity|limit/u);
      assert.deepEqual(shellValueBytes(command.bindings.get("a")!), Uint8Array.of(255));
      await transaction.commit();
      await writer.set(2, "continued");
    } finally { await transaction.close(); await writer.close(); }
    return 0;
  }, 8192);
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "%s" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff6163636570746564636f6e74696e756564");
});

test("ordinary callback execution between records does not cause full-array copying", async context => {
  const original = IndexedBinding.prototype.copy;
  let copiedCells = 0;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    copiedCells += this.values.size;
    return original.call(this, signal);
  });
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      for (let index = 0; index < 64; index++) {
        assert.equal(await command.evaluate(":"), 0);
        await writer.set(index, "record");
      }
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "%s" "${#a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "64");
  assert.equal(copiedCells, 0);
});

test("retained generic byte values survive incremental overwrite without replacement-text aliasing", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, shellValueFromBytes(Uint8Array.of(255)));
      const retained = command.bindings.get("a")!;
      await writer.set(0, "�");
      await writer.set(1, retained);
      assert.deepEqual(shellValueBytes(retained), Uint8Array.of(255));
      assert.deepEqual(shellValueBytes(command.bindings.get("a")!), Uint8Array.of(239, 191, 189));
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "%s" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "efbfbdff");
});
