import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { IndexedBinding } from "../../../../src/shell/arrays/bindings.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [{ name: "mapfile-prerequisite-probe", create: () => ({ builtins: [{ name: "probe", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

test("current one-shot transaction cannot publish successive callback-visible records", async context => {
  const { shell } = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed", clear: true });
    try {
      await transaction.set(0, "one");
      assert.equal(command.bindings.get("a"), "old");
      await transaction.commit();
      assert.equal(command.bindings.get("a"), "one");
      await assert.rejects(transaction.set(1, "two"), /closed/u);
    } finally { await transaction.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=(old); probe");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("reopening transactions for every record copies all preceding cells", async context => {
  const copy = IndexedBinding.prototype.copy;
  let copiedCells = 0;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    copiedCells += this.values.size;
    return copy.call(this, signal);
  });
  const { shell } = setup(async command => {
    for (let index = 0; index < 32; index++) {
      const transaction = await command.bindings.prepare("a", { kind: "indexed" });
      try { await transaction.set(index, "record"); await transaction.commit(); }
      finally { await transaction.close(); }
    }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("probe");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(copiedCells, 32 * 31 / 2);
});

test("callback readonly prevents a current transaction write unlike admitted native mapfile", async context => {
  const { shell } = setup(async command => {
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    try {
      assert.equal(await command.evaluate("readonly a"), 0);
      await assert.rejects(transaction.set(1, "two"), /readonly/u);
    } finally { await transaction.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=(one); probe");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("current indexed preparation rejects native-compatible exported scalar promotion", async context => {
  const { shell } = setup(async command => {
    assert.equal(command.bindings.describe("a").exported, true);
    await assert.rejects(command.bindings.prepare("a", { kind: "indexed", clear: true }), /exported/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("export a=old; probe");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("borrowed VFS record loses the embedded-NUL truncation boundary needed by mapfile", async context => {
  const { fs, shell } = setup(async command => {
    const lease = command.input.borrow(3);
    try {
      const record = await lease.read(true);
      try {
        assert.equal(record.reason, "delimiter");
        assert.deepEqual(Buffer.from(shellValueBytes(record.shellValue)), Buffer.from("ab"));
      } finally { await record.release(); }
    } finally { await lease.release(); }
    return 0;
  });
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("a\0b\nc\n"));
  await fs.writeFile("/script", Buffer.from(`{ probe; read -r tail <&4; printf '%s' "$tail"; } 3</input 4<&3`));
  const result = await shell.exec("source /script");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "c");
  assert.equal(result.stderr, "");
});

test("callback exit must unwind active extension evaluation before owner cleanup", async context => {
  const events: string[] = [];
  const { shell } = setup(async command => {
    command.registerCleanup(() => { events.push("owner cleanup"); });
    try { return await command.evaluate("callback"); }
    finally { events.push("callback unwind"); }
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("callback() { exit 7; }; probe");
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(events, ["callback unwind", "owner cleanup"]);
});
