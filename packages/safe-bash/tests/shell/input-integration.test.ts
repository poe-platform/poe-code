import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { prepareFileInput, ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { shellValueBytes } from "../../src/contracts/value.js";

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

test("prepared canonical files expose truthful metadata and bounded chunks without inventing seek", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array([1, 2, 3]));
  const budget = new Budget(defaultLimits);
  const cleanups: (() => void | Promise<void>)[] = [];
  const prepared = await prepareFileInput({ fs: memory, signal: budget.signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/input", budget);
  try {
    assert.equal(prepared.options.stat?.size, 3);
    assert.ok(prepared.options.descriptor);
    assert.equal(prepared.options.seek, undefined);
    const first = await prepared.options.readChunk!(1);
    assert.equal(first.done, false);
    assert.deepEqual([...first.value!], [1]);
    assert.equal(await prepared.options.descriptor.getPosition!(), 1);
  } finally {
    await prepared.close();
    await Promise.all(cleanups.map(cleanup => cleanup()));
    budget.close(); budget.values.close();
  }
});

test("prepared retained-only files preserve seek, bounded reads, and post-EOF replay", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array([1, 2, 3]));
  Object.defineProperty(memory, "capabilities", { value: { ...memory.capabilities, open: false } });
  const budget = new Budget(defaultLimits);
  const cleanups: (() => void | Promise<void>)[] = [];
  const prepared = await prepareFileInput({ fs: memory, signal: budget.signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/input", budget);
  const input = new ShellInput(prepared.source, budget, budget.signal, prepared.options);
  try {
    assert.equal(input.stat?.size, 3);
    assert.equal(input.descriptor, undefined);
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
