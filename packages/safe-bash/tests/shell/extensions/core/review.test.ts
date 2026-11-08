import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellBindingTransaction, ShellExtensionBuiltin, ShellExtensionContext, ShellInputBorrow } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

const positionalCases = [
  { name: "zero-prefixed lengths retain incomplete raw characters", source: `set -- $'\\xe2\\x82'; printf '<%s>' "\${#01}" "\${#0001}"`, expected: "3c323e3c323e" },
  { name: "zero-prefixed positional values preserve raw identity", source: `set -- $'\\xff'; printf '<%s>' "\${01}" "\${#01}"`, expected: "3cff3e3c313e" },
  { name: "unset positional lengths retain default grammar", source: `set --; printf '<%s>' "\${#1}" "\${#10}" "\${#}"`, expected: "3c303e3c303e3c303e" },
] as const;

for (const locale of ["C", "en_US.UTF-8"]) for (const entry of positionalCases) {
  test(`review: ${locale}: ${entry.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(entry.source, { env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), entry.expected);
  });
}

test("review: pinned native confirms zero-prefixed and unset positional expectations", nativeOptions(), () => {
  for (const locale of ["C", "en_US.UTF-8"]) for (const entry of positionalCases) {
    const native = runNative(`LC_ALL=${locale}; ${entry.source}`);
    assert.equal(native.status, 0, `${locale}: ${entry.name}`);
    assert.equal(native.stderr.length, 0, `${locale}: ${entry.name}`);
    assert.equal(native.stdout.toString("hex"), entry.expected, `${locale}: ${entry.name}`);
  }
});

function extensionShell(execute: (context: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [{ name: "review-core", create: () => ({ builtins: [{ name: "inspect", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

test("review: released input records transfer immutable raw cells into canonical transactions", async context => {
  const reusable = Uint8Array.of(255, 32, 254, 10);
  const { shell } = extensionShell(async command => {
    const borrow = command.input.borrow(0);
    const record = await borrow.read(true);
    const fields = await record.fields(" ", 2);
    const transaction = await command.bindings.prepare("cells", { kind: "indexed", clear: true });
    await transaction.set(0, fields[0]!.value);
    await transaction.set(1, fields[1]!.value);
    await record.release();
    const tail = await borrow.read(true);
    assert.equal(Buffer.from(shellValueBytes(tail.shellValue)).toString(), "tail");
    await tail.release();
    await borrow.release();
    await transaction.commit();
    await transaction.close();
    const copy = shellValueBytes(command.bindings.get("cells")!);
    copy.fill(66);
    assert.deepEqual(shellValueBytes(command.bindings.get("cells")!), Uint8Array.of(255));
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() { yield reusable; reusable.fill(65); yield Buffer.from("tail\n"); } };
  const result = await shell.exec(`cells=(old); inspect; printf '<%s>' "\${cells[@]}"`, { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cff3e3cfe3e");
});

for (const mutation of ["unset cells; cells=original", "export cells", "readonly cells"]) {
  test(`review: scalar promotion transaction rejects intervening mutation: ${mutation}`, async context => {
    const { shell } = extensionShell(async command => {
      const transaction = await command.bindings.prepare("cells", { kind: "indexed" });
      try {
        await transaction.set(2, shellValueFromBytes(Uint8Array.of(255)));
        await command.evaluate(mutation);
        await assert.rejects(transaction.commit(), /changed|exported|readonly/);
        assert.equal(command.bindings.describe("cells").kind, "scalar");
        assert.equal(command.bindings.get("cells"), "original");
      } finally { await transaction.close(); }
      return 0;
    });
    context.after(() => shell.dispose());
    const result = await shell.exec("cells=original; inspect");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  });
}

test("review: local restoration and invocation retirement preserve outer byte identity", async context => {
  let saved: ShellBindingTransaction | undefined;
  let borrow: ShellInputBorrow | undefined;
  const { shell } = extensionShell(async command => {
    saved = await command.bindings.prepare("cells", { kind: "indexed", clear: true });
    await saved.set(0, shellValueFromBytes(Uint8Array.of(254)));
    await saved.commit();
    borrow = command.input.borrow(0);
    const abandoned = await command.bindings.prepare("abandoned", { kind: "indexed" });
    await abandoned.set(0, shellValueFromBytes(Uint8Array.of(253)));
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`cells=($'\\xff' '�'); f() { local -a cells; inspect; printf '<%s>' "\${cells[@]}"; }; f; printf '<%s>' "\${cells[@]}" "\${abandoned-unset}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cfe3e3cff3e3cefbfbd3e3c756e7365743e");
  assert.throws(() => saved!.get(0), /closed/);
  await assert.rejects(saved!.set(0, "late"), /closed/);
  await assert.rejects(borrow!.read(true), /closed/);
  await saved!.close();
  await borrow!.release();
});

test("review: releasing a queued descriptor alias read cannot consume a sibling's next record", async context => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finalized = 0;
  const { shell } = extensionShell(async command => {
    const first = command.input.borrow(0);
    const second = command.input.borrow(3);
    const reading = first.read(true);
    await started;
    const queued = second.read(true);
    const rejected = assert.rejects(queued, /closed/);
    try {
      await second.release();
      await rejected;
      assert.equal(finalized, 0);
      release();
      const record = await reading;
      assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255));
      await record.release();
      await first.release();
      const third = command.input.borrow(3);
      const tail = await third.read(true);
      assert.deepEqual(shellValueBytes(tail.shellValue), Uint8Array.of(254));
      await tail.release();
      await third.release();
    } finally { release(); await reading; await rejected; await first.release(); await second.release(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() {
    try { entered(); await gate; yield Uint8Array.of(255, 10, 254, 10); }
    finally { finalized++; }
  } };
  try {
    const result = await shell.exec("inspect 3<&0", { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(finalized, 1);
  } finally { release(); }
});

test("review: declaration metadata and receiver remain captured through all existing dispatch prefixes", async context => {
  const observed: string[][] = [];
  class MutableBuiltin implements ShellExtensionBuiltin {
    readonly name = "record";
    readonly marker = "receiver";
    expansion: "ordinary" | "declaration" = "declaration";
    execute(command: ShellExtensionContext) {
      assert.equal(this.marker, "receiver");
      observed.push(command.argumentValues.map(value => Buffer.from(shellValueBytes(value)).toString("hex")));
      this.expansion = "ordinary";
      this.execute = () => { throw new Error("uncaptured replacement"); };
      return 0;
    }
  }
  const builtin = new MutableBuiltin();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "captured-review", create: () => ({ builtins: [builtin] }) }] });
  context.after(() => shell.dispose());
  const prefixes = ["", "command ", "builtin ", "command -- ", "builtin -- ", "command builtin -- "];
  const result = await shell.exec(`value=$'\\xff z'; ${prefixes.map(prefix => `${prefix}record name=$value`).join("; ")}`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(observed, prefixes.map(() => ["6e616d653dff207a"]));
});
