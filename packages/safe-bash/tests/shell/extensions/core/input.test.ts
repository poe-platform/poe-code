import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [{ name: "input", create: () => ({ builtins: [{ name: "consume", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

test("borrowed default input retains canonical bytes and leaves unread data for read", async context => {
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.stdinIsDefault, false);
    const record = await lease.read(true);
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"), "ff");
    await record.release();
    await lease.release();
    await assert.rejects(lease.read(true), /closed/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`consume; read -r rest; printf '%s' "$rest"`, { stdin: Buffer.from("ff0a7461696c0a", "hex") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "tail");
});

test("duplicated descriptors share one cursor across released borrows", async context => {
  const { fs, shell } = setup(async command => {
    for (const [descriptor, expected] of [[3, "one"], [4, "two"], [3, "three"]] as const) {
      const lease = command.input.borrow(descriptor);
      const record = await lease.read(true);
      assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString(), expected);
      await lease.release();
    }
    return 0;
  });
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("one\ntwo\nthree\n"));
  const result = await shell.exec("consume 3</input 4<&3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("borrow rejects missing, closed and output-only descriptors without consumption", async context => {
  const { shell } = setup(async command => {
    for (const descriptor of [0, 1, 2, 3, 9, -1, 1.5]) assert.throws(() => command.input.borrow(descriptor), /descriptor/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume 0<&- 3>/output");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("descriptor records use current locale and cannot outlive the invocation", async context => {
  let saved: ShellExtensionContext | undefined;
  const { shell } = setup(async command => {
    saved = command;
    const lease = command.input.borrow(0);
    const record = await lease.read(true, { count: 1, exact: true });
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"), "c3");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume", { stdin: Buffer.from("é"), env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.throws(() => saved!.input.borrow(0), /closed/u);
});

for (const reason of [false, 0, "", null]) test(`borrowed input cancellation drains cooperative work: ${String(reason)}`, async context => {
  const controller = new AbortController();
  let finalized = false;
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    const record = await lease.read(true);
    await record.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() {
    try { controller.abort(reason); yield Uint8Array.of(255); }
    finally { finalized = true; }
  } };
  await assert.rejects(shell.exec("consume", { stdin, signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(finalized, true);
});
