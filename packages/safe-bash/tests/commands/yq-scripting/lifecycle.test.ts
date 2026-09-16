import assert from "node:assert/strict";
import { test } from "node:test";
import type { ByteSource, InvocationCleanup } from "../../../src/contracts/index.js";
import { createYqCommand } from "../../../src/commands/yq/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { run } from "./helpers.js";

for (const reason of [false, 0, "", null]) {
  for (const enrolled of [false, true]) test(`producer teardown is awaited with cancellation ${String(reason)} (enrolled=${enrolled})`, { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const cleanups: InvocationCleanup[] = [];
    let release!: () => void, closing!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { closing = resolve; });
    let returns = 0, settled = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { controller.abort(reason); return { done: false, value: new Uint8Array() }; },
      async return() { returns++; closing(); await gate; throw new Error("secondary cleanup"); },
    }; } };
    const operation = run(["."], "", {
      stdin, signal: controller.signal,
      ...(enrolled ? { registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); } } : {}),
    });
    const checked = assert.rejects(operation, error => Object.is(error, reason));
    void operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
    } finally {
      release();
      await checked;
      await Promise.allSettled(cleanups.map(cleanup => cleanup()));
    }
    assert.equal(returns, 1);
  });
}

test("Shell exec cancellation awaits yq VFS producer teardown", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("root cancellation");
  let release!: () => void, closing!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { closing = resolve; });
  let returns = 0, settled = false;
  const fs = createMemoryFileSystem();
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { controller.abort(reason); return { done: false, value: new Uint8Array() }; },
    async return() { returns++; closing(); await gate; return { done: true, value: undefined }; },
  }; } });
  const shell = new Shell({ fs });
  shell.register(createYqCommand());
  const operation = shell.exec("yq . /input.yaml", { signal: controller.signal });
  const checked = assert.rejects(operation, error => error === reason);
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    release();
    await checked;
    await shell.dispose();
  }
  assert.equal(returns, 1);
});

test("opaque pending reads without teardown do not become owned cancellation work", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel opaque read");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { controller.abort(reason); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
  }; } };
  await assert.rejects(run(["."], "", { stdin, signal: controller.signal }), error => error === reason);
});

test("completed producers are not returned again", async () => {
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: true, value: undefined }; },
    async return() { returns++; throw new Error("completed producer returned"); },
  }; } };
  assert.deepEqual(await run(["."], "", { stdin }), { status: 0, stdout: "", stderr: "" });
  assert.equal(returns, 0);
});
