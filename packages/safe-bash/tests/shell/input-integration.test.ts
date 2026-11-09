import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { prepareFileInput, ShellInput } from "../../src/shell/input.js";
import { Shell } from "../../src/shell/index.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { CommandRegistry, writeText, toByteSource } from "../../src/contracts/index.js";
import { shellValueBytes } from "../../src/contracts/value.js";
import { printfCommand } from "../../src/commands/basic.js";
import { readExtension } from "../../src/shell/extensions/read/index.js";
import { setup } from "./helpers.js";

for (const entry of [
  { name: "incomplete two-byte character", prefix: [0xc3], delimiter: 10 },
  { name: "incomplete three-byte character", prefix: [0xe2, 0x82], delimiter: 10 },
  { name: "incomplete four-byte character", prefix: [0xf0, 0x9f, 0x92], delimiter: 10 },
  { name: "colon after incomplete character", prefix: [0xc3], delimiter: 58 },
  { name: "colon after partial continuation", prefix: [0xe2, 0x82], delimiter: 58 },
  { name: "NUL after incomplete character", prefix: [0xc3], delimiter: 0 },
  { name: "NUL after partial continuation", prefix: [0xe2, 0x82], delimiter: 0 },
  { name: "valid UTF-8", prefix: [0xc3, 0xa9], delimiter: 10 },
  { name: "byte locale", prefix: [0xc3], delimiter: 10, locale: "C" },
  { name: "character count leaves stream delimiter unread", prefix: [0xc3], delimiter: 10, flags: "-n 2", streamNext: [] },
  { name: "delimiter before character count", prefix: [0xc3], delimiter: 10, flags: "-n 3" },
  { name: "exact character count", prefix: [0xc3], delimiter: 10, flags: "-N 2", retained: [10] },
  { name: "exact count ignores colon", prefix: [0xc3], delimiter: 58, flags: "-N 2", retained: [58] },
  { name: "exact count ignores NUL", prefix: [0xc3], delimiter: 0, flags: "-N 2" },
]) {
  for (const extension of [false, true]) {
    for (const input of ["file", "split stream"]) {
      test(`Bash 5.3 read delimiter: ${entry.name}, extension=${extension}, ${input}`, async context => {
        const { shell, fs, commands } = setup({ extensions: extension ? [readExtension()] : [] });
        context.after(() => shell.dispose());
        commands.register(printfCommand);
        const bytes = Uint8Array.from([97, ...entry.prefix, entry.delimiter, 98, entry.delimiter, 90, entry.delimiter]);
        const delimiter = entry.delimiter === 10 ? "" : entry.delimiter === 0 ? "-d ''" : "-d ':'";
        const source = `{ IFS= read -r ${entry.flags ?? ""} ${delimiter} a; rc=$?; IFS= read -r ${delimiter} b; printf '%s|%s|%s|%s' "$rc" "$?" "$a" "$b"; }`;
        if (input === "file") await fs.writeFile("/data", bytes);
        const result = await shell.exec(source + (input === "file" ? " </data" : ""), {
          env: { LC_ALL: entry.locale ?? "C.UTF-8" },
          ...(input === "file" ? {} : { stdin: { async *[Symbol.asyncIterator]() {
            for (const byte of bytes) yield Uint8Array.of(byte);
          } } }),
        });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, Uint8Array.from([48, 124, 48, 124, 97, ...entry.prefix, ...(entry.retained ?? []), 124, ...(input === "split stream" ? entry.streamNext ?? [98] : [98])]));
      });
    }
  }
}

test("bounded reads, byte-valued lines, and raw records share one consumed position", async () => {
  const budget = new Budget(defaultLimits);
  const storage = new Uint8Array([0xff, 10, 65, 10]);
  const input = new ShellInput({ async *[Symbol.asyncIterator]() { yield storage; } }, budget, budget.signal, { provenance: "stream" });
  try {
    const first = await input.read(1, budget.signal);
    assert.equal(first.done, false);
    assert.deepEqual([...first.value!], [255]);
    assert.equal(input.position, 1);
    assert.equal(input.readiness(), "ready");
    storage.fill(0);
    const line = await input.line(true);
    try { assert.equal(line.reason, "delimiter"); assert.equal(line.value, ""); }
    finally { await line.release(); }
    assert.equal(input.position, 2);
    const record = await input.record();
    try { assert.deepEqual([...shellValueBytes(record.shellValue)], [65, 10]); }
    finally { await record.release(); }
    assert.equal(input.position, 4);
  } finally { await input.close(); budget.close(); budget.values.close(); }
});

test("prepared canonical files expose truthful metadata and bounded chunks with seek", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array([1, 2, 3]));
  const budget = new Budget(defaultLimits);
  const cleanups: (() => void | Promise<void>)[] = [];
  const prepared = await prepareFileInput({ fs: memory, signal: budget.signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/input", budget);
  try {
    assert.equal(prepared.options.stat?.size, 3);
    assert.ok(prepared.options.descriptor);
    assert.ok(prepared.options.seek);
    await prepared.options.seek(2, budget.signal);
    assert.deepEqual([...(await prepared.options.readChunk!(1)).value!], [3]);
    await prepared.options.seek(0, budget.signal);
    const first = await prepared.options.readChunk!(1);
    assert.equal(first.done, false);
    assert.deepEqual([...first.value!], [1]);

  } finally {
    await prepared.close();
    await Promise.all(cleanups.map(cleanup => cleanup()));
    budget.close(); budget.values.close();
  }
});

for (const canonical of [true, false]) test(`prepared files preserve seek, bounded reads, and post-EOF replay (canonical=${canonical})`, async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array([1, 2, 3]));
  if (!canonical) Object.defineProperty(memory, "capabilities", { value: { ...memory.capabilities, open: false } });
  const budget = new Budget(defaultLimits);
  const cleanups: (() => void | Promise<void>)[] = [];
  const prepared = await prepareFileInput({ fs: memory, signal: budget.signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/input", budget);
  const input = new ShellInput(prepared.source, budget, budget.signal, prepared.options);
  try {
    assert.equal(input.stat?.size, 3);
    assert.equal(Boolean(input.descriptor), canonical);
    assert.ok(input.seek);
    assert.deepEqual([...(await input.read(3, budget.signal)).value!], [1, 2, 3]);
    assert.equal((await input.next()).done, true);
    await input.seek(1, budget.signal);
    assert.deepEqual([...(await input.read(1, budget.signal)).value!], [2]);
    assert.equal(input.position, 2);
  } finally {
    await input.close(); await prepared.close();
    await Promise.all(cleanups.map(cleanup => cleanup()));
    budget.close(); budget.values.close();
  }
});

for (const bytes of [new TextEncoder().encode("line1\nline2\n"), new Uint8Array([255, 10, 65, 10])]) {
  test(`synchronous mapfile records advance once (${bytes[0]})`, async () => {
    const budget = new Budget(defaultLimits);
    const input = new ShellInput(toByteSource(bytes), budget, budget.signal);
    try {
      const allocation = { assertOpen() {}, reserve() { return { commit() {}, release() {} }; } };
      assert.ok(input.tryMapfileRecordSync(10, true, allocation)?.present);
      assert.equal(input.position, bytes.indexOf(10) + 1);
      assert.ok(input.tryMapfileRecordSync(10, true, allocation)?.present);
      assert.equal(input.position, bytes.length);
    } finally { await input.close(); budget.close(); budget.values.close(); }
  });
}

test("failed mapfile byte-value admission preserves the unread record", async () => {
  const budget = new Budget(defaultLimits);
  const input = new ShellInput(toByteSource(new Uint8Array([255, 10, 65, 10])), budget, budget.signal);
  let reservations = 0;
  const failure = new Error("allocation rejected");
  const allocation = { assertOpen() {}, reserve() {
    if (++reservations === 2) throw failure;
    return { commit() {}, release() {} };
  } };
  try {
    assert.throws(() => input.tryMapfileRecordSync(10, true, allocation), error => error === failure);
    assert.equal(input.position, 0);
    const record = input.tryMapfileRecordSync(10, true, allocation)!;
    assert.deepEqual([...shellValueBytes(record.value)], [255]);
    assert.equal(input.position, 2);
  } finally { await input.close(); budget.close(); budget.values.close(); }
});

test("mapfile and admitted seeking share redirected descriptor input", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("line1\nline2\nline3\n"));
  const commands = new CommandRegistry([{ name: "inspect", async execute(context) {
    assert.equal(context.stdinInput?.position, 12);
    const handle = await context.admittedHandles!.acquire(0, ["read", "seek"], context.signal);
    try {
      await handle.seek!(0, context.signal);
      const first = await handle.read!(6, context.signal);
      await context.stdout.write(first.value!);
      await context.stdinInput!.seek!(12, context.signal);
      const last = await context.stdinInput!.read(6, context.signal);
      await context.stdout.write(last.value!);
      await writeText(context.stdout, String(context.stdinInput!.position));
    } finally { await handle.close(); }
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands });
  try {
    const result = await shell.exec("{ mapfile -t -n 2 A; inspect; } < /input");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "line1\nline3\n18", ""]);
  } finally { await shell.dispose(); }
});

test("canonical descriptors without positioned reads do not advertise seek", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array([1]));
  const open = fs.open.bind(fs);
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    Object.defineProperty(descriptor, "capabilities", { value: { ...descriptor.capabilities, positionedRead: false } });
    return descriptor;
  };
  const budget = new Budget(defaultLimits);
  const prepared = await prepareFileInput({ fs, signal: budget.signal, registerCleanup() {} }, "/input", budget);
  try { assert.equal(prepared.options.seek, undefined); }
  finally { await prepared.close(); budget.close(); budget.values.close(); }
});

test("available delimited reads retain owned remainder and advance only consumed bytes", async () => {
  const budget = new Budget(defaultLimits);
  const storage = Uint8Array.of(255, 0, 65, 10);
  const input = new ShellInput(toByteSource(storage), budget, budget.signal);
  try {
    assert.deepEqual((await input.readAvailable(0, budget.signal, 0)).value, new Uint8Array());
    assert.equal(input.position, 0);
    assert.deepEqual((await input.readAvailable(64, budget.signal, 0)).value, Uint8Array.of(255, 0));
    assert.equal(input.position, 2);
    storage.fill(9);
    assert.deepEqual((await input.readAvailable(1, budget.signal, 10)).value, Uint8Array.of(65));
    assert.equal(input.position, 3);
    assert.deepEqual((await input.readAvailable(64, budget.signal, 10)).value, Uint8Array.of(10));
    assert.equal(input.position, 4);
    assert.equal((await input.readAvailable(64, budget.signal, 10)).done, true);
  } finally { await input.close(); budget.close(); budget.values.close(); }
});

test("available reads reject invalid delimiters without consuming input", async () => {
  const budget = new Budget(defaultLimits);
  const input = new ShellInput(toByteSource("abc"), budget, budget.signal);
  try {
    for (const delimiter of [-1, 256, 1.5, NaN]) {
      await assert.rejects(input.readAvailable(64, budget.signal, delimiter), RangeError);
      assert.equal(input.position, 0);
    }
    assert.deepEqual((await input.readAvailable(64, budget.signal)).value, new TextEncoder().encode("abc"));
  } finally { await input.close(); budget.close(); budget.values.close(); }
});
