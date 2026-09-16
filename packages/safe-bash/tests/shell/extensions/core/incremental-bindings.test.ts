import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { IndexedBinding } from "../../../../src/shell/arrays/bindings.js";
import type { ShellExtensionContext, ShellIndexedWriter } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function setup(execute: (command: ShellExtensionContext) => Promise<number>, maxExpansionBytes?: number) {
  const shell = new Shell({ fs: createMemoryFileSystem(), ...(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } }), extensions: [{ name: "incremental-probe", create: () => ({ builtins: [{ name: "records", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

test("writer admits and clears before input acquisition, then publishes each raw record", async context => {
  let acquired = false;
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    assert.equal(acquired, false);
    assert.equal(command.bindings.describe("a").kind, "indexed");
    assert.equal(command.bindings.get("a"), undefined);
    const input = command.input.borrow(0);
    try {
      for (let index = 0; index < 2; index++) {
        const record = await input.read(true);
        try { await writer.set(index, record.shellValue); }
        finally { await record.release(); }
        assert.equal(Buffer.from(shellValueBytes(command.bindings.get("a", index)!)).toString("hex"), index === 0 ? "ff" : "fe");
      }
    } finally { await input.release(); await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() { acquired = true; yield Uint8Array.of(255, 10, 254, 10); } };
  const result = await shell.exec(`a=(old tail); records; printf '%s' "\${a[@]}"`, { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "fffe");
});

test("readonly admission fails before reading any record", async context => {
  let pulled = false;
  const shell = setup(async command => {
    await assert.rejects(command.bindings.openIndexed("a", { clear: true }), /readonly/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=old; readonly a; records", { stdin: { async *[Symbol.asyncIterator]() { pulled = true; yield Buffer.from("bad\n"); } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(pulled, false);
});

for (const clear of [false, true]) test(`exported scalar admission preserves export attribute, clear=${clear}`, async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear });
    try {
      assert.deepEqual(command.bindings.describe("a"), { kind: "indexed", readonly: false, exported: true });
      assert.equal(command.bindings.get("a"), clear ? undefined : "old");
      await writer.set(1, "record");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`export a=old; records; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, clear ? "<record>" : "<old><record>");
});

test("callback readonly affects ordinary assignment but not an already-admitted writer", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, "one");
      assert.equal(await command.evaluate("readonly a"), 0);
      await assert.rejects(command.bindings.assign("a", "bad"), /readonly/u);
      await assert.rejects(command.bindings.prepare("a", { kind: "indexed" }), /readonly/u);
      await writer.set(1, "two");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(old); records; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<one><two>");
});

test("callback replacement follows the current array rather than retired storage", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, "one");
      assert.equal(await command.evaluate("a=(callback)"), 0);
      await writer.set(1, "two");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`records; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<callback><two>");
});

test("readonly after admission but before the first record does not revoke the writer", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      assert.equal(await command.evaluate("readonly a"), 0);
      await writer.set(0, "one");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('records; printf "%s" "$a"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "one");
});

test("scalar promotion preserves raw bytes distinct from genuine replacement characters", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    try {
      assert.equal(Buffer.from(shellValueBytes(command.bindings.get("a")!)).toString("hex"), "ff");
      await writer.set(1, "�");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=$'\\xff'; records; printf '%s' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ffefbfbd");
});

test("incremental revision invalidates an earlier one-shot transaction", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    const transaction = await command.bindings.prepare("a", { kind: "indexed" });
    try {
      await transaction.set(1, "stale");
      await writer.set(0, "current");
      await assert.rejects(transaction.commit(), /changed|stale/u);
      assert.equal(command.bindings.get("a"), "current");
      assert.equal(command.bindings.get("a", 1), undefined);
    } finally { await transaction.close(); await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("a=(old); records");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const replacement of ["unset a", "unset a; a=scalar", "unset a; a=(replacement); readonly a"]) test(`lost admitted identity fails closed: ${replacement}`, async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, "one");
      assert.equal(await command.evaluate(replacement), 0);
      await assert.rejects(writer.set(1, "forbidden"), /identity|target/u);
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("records");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("incremental writes do not copy all preceding cells", async context => {
  const copy = IndexedBinding.prototype.copy;
  let copiedCells = 0;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    copiedCells += this.values.size;
    return copy.call(this, signal);
  });
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try { for (let index = 0; index < 128; index++) await writer.set(index, "record"); }
    finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`records; printf '%s' "\${#a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "128");
  assert.equal(copiedCells, 0);
});

test("incremental mutation preserves a retained snapshot with one copy-on-write", async context => {
  const insert = IndexedBinding.prototype.insert;
  const observed: IndexedBinding[] = [];
  context.mock.method(IndexedBinding.prototype, "insert", function (this: IndexedBinding, ...args: Parameters<IndexedBinding["insert"]>) {
    insert.apply(this, args);
    if (args[1].value === "one") observed.push(this);
  });
  const copy = IndexedBinding.prototype.copy;
  let copiedCells = 0;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    copiedCells += this.values.size;
    return copy.call(this, signal);
  });
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    await writer.set(0, "one");
    const snapshot = observed[0]!.retain();
    try {
      await writer.set(0, "two");
      await writer.set(1, "three");
      assert.equal(snapshot.get(0), "one");
      assert.equal(snapshot.get(1), undefined);
      assert.equal(command.bindings.get("a"), "two");
    } finally { await snapshot.release(); await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("records");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(copiedCells, 1);
});

test("local restoration survives incremental mutation and snapshot activity", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    try {
      await writer.set(0, command.argumentValues[0]!);
      assert.equal(await command.evaluate('(a[0]=child; :)'), 0);
      await writer.set(1, "tail");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(outer); f() { local a=local; records $'\\xff'; printf '%s' "\${a[@]}"; }; f; printf '%s' "$a"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff7461696c6f75746572");
});

test("writer accepts uint32 cells without widening one-shot transactions or allocating a dense array", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(4294967295, "one");
      await writer.set(0, "two");
      await writer.set(2147483648, "middle");
      for (const index of [-1, 0.5, 4294967296, Number.MAX_SAFE_INTEGER]) await assert.rejects(writer.set(index, "bad"), /index/u);
      const strict = await command.bindings.prepare("b", { kind: "indexed" });
      try { await assert.rejects(strict.set(2147483648, "bad"), /index/u); }
      finally { await strict.close(); }
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`records; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<two><middle><one>");
});

test("prior records survive a refused shared-budget admission", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, "one");
      await assert.rejects(writer.set(1, shellValueFromBytes(new Uint8Array(65536).fill(255))), /capacity|limit/u);
      assert.equal(command.bindings.get("a"), "one");
      assert.equal(command.bindings.get("a", 1), undefined);
    } finally { await writer.close(); }
    return 0;
  }, 8192);
  context.after(() => shell.dispose());
  const result = await shell.exec("records");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("uint32 read selectors support lengths and presence without widening transactions", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    try {
      await writer.set(4294967295, shellValueFromBytes(Uint8Array.of(255)));
      assert.deepEqual(shellValueBytes(command.bindings.get("a", 4294967295)!), Uint8Array.of(255));
      assert.throws(() => command.bindings.get("a", 4294967296), /index/u);
      const strict = await command.bindings.prepare("a", { kind: "indexed" });
      try {
        assert.throws(() => strict.get(4294967295), /index/u);
        await assert.rejects(strict.set(4294967295, "bad"), /index/u);
      } finally { await strict.close(); }
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('LC_ALL=C; records; [[ -v a[4294967295] ]] && printf "%s" "${#a[4294967295]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "1");
});

test("a writer admitted to a local rejects deeper shadows but survives unshadowed callbacks", async context => {
  let writer: ShellIndexedWriter | undefined;
  const shell = setup(async command => {
    if (command.args[0] === "shadow") {
      await assert.rejects(writer!.set(1, "leaked"), /identity|target/u);
      return 0;
    }
    if (command.args[0] === "nested") {
      await writer!.set(1, "nested");
      return 0;
    }
    writer = await command.bindings.openIndexed("a");
    try {
      await writer.set(0, "local");
      assert.equal(await command.evaluate('shadow() { local a=inner; readonly a; records shadow; printf "<%s>" "$a"; }; shadow; nested() { local b=other; records nested; }; nested'), 0);
      await writer.set(2, "tail");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec('a=(outer); f() { local a=initial; records; printf "<%s>" "${a[@]}"; }; f; printf "<%s>" "$a"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<inner><local><nested><tail><outer>");
});

test("close drains an admitted write and prevents its late publication", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    await writer.set(0, "one");
    const pending = writer.set(1, shellValueFromBytes(Uint8Array.of(255)));
    const closing = writer.close();
    await assert.rejects(pending, /closed/u);
    await closing;
    assert.equal(command.bindings.get("a", 1), undefined);
    await assert.rejects(writer.set(1, "late"), /closed/u);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("records");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("root cancellation waits for an enrolled copy and preserves its falsey reason", async context => {
  let entered!: () => void;
  let release!: () => void;
  const copying = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const observed: IndexedBinding[] = [];
  const insert = IndexedBinding.prototype.insert;
  context.mock.method(IndexedBinding.prototype, "insert", function (this: IndexedBinding, ...args: Parameters<IndexedBinding["insert"]>) {
    insert.apply(this, args);
    if (args[1].value === "one") observed.push(this);
  });
  const copy = IndexedBinding.prototype.copy;
  context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
    const result = await copy.call(this, signal);
    entered();
    await gate;
    return result;
  });
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    await writer.set(0, "one");
    const snapshot = observed[0]!.retain();
    try { await writer.set(1, "two"); }
    finally { await snapshot.release(); await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const controller = new AbortController();
  const execution = shell.exec("records", { signal: controller.signal });
  let settled = false;
  const rejected = assert.rejects(execution, error => Object.is(error, false)).finally(() => { settled = true; });
  try {
    await copying;
    controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release(); }
  await rejected;
});

for (const reason of [false, 0, "", null]) test(`incremental cancellation preserves falsey root reason: ${String(reason)}`, async context => {
  const controller = new AbortController();
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a");
    await writer.set(0, shellValueFromBytes(Uint8Array.of(255)));
    controller.abort(reason);
    await writer.set(1, "late");
    return 0;
  });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("records", { signal: controller.signal }), error => Object.is(error, reason));
});

test("incremental writes preserve temporary scalar assignment restoration", async context => {
  const shell = setup(async command => {
    const writer = await command.bindings.openIndexed("a", { clear: true });
    try {
      await writer.set(0, "one");
      await writer.set(1, "two");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=outer; a=temporary records; printf '<%s>' "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<outer>");
});

const nativeCases = [
  ['LC_ALL=C; mapfile -t -O4294967295 a; [[ -v a[4294967295] ]] && printf "%s" "${#a[4294967295]}"', "x\n", "1"],
  ["a=outer; a=temporary mapfile -t a; printf '<%s>' \"${a[@]}\"", "one\ntwo\n", "<outer>"],
  ["a=(outer tail); a=temporary mapfile -t a; printf '<%s>' \"${a[@]}\"", "one\ntwo\n", "<outer><tail>"],
  ["export a=old; mapfile -t -O1 a; printf '<%s>' \"${a[@]}\"", "record\n", "<old><record>"],
  ["a=(old); cb() { readonly a; }; mapfile -t -C cb -c1 a; printf '<%s>' \"${a[@]}\"", "one\ntwo\n", "<one><two>"],
  ["cb() { a=(callback); }; mapfile -t -C cb -c1 a; printf '<%s>' \"${a[@]}\"", "one\ntwo\n", "<callback><two>"],
  ["mapfile -t -O4294967295 a; printf '<%s>' \"${a[@]}\"", "one\ntwo\n", "<two><one>"],
  ["a=(old); mapfile -t -O2147483648 a; printf '<%s>' \"${a[@]}\"", "middle\n", "<old><middle>"],
] as const;

for (const [source, input, expected] of nativeCases) test(`pinned native incremental contract: ${source}`, nativeOptions(), () => {
  const result = runNative(source, input);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.toString(), "");
  assert.equal(result.stdout.toString(), expected);
});
