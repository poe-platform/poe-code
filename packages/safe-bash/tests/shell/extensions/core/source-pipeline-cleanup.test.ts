import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { agentCommands } from "../../../../src/plugins/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function intercept<Target extends object>(subject: Target, overrides: Partial<Target>): Target {
  return new Proxy(subject, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function setup(close?: () => void | Promise<void>) {
  const memory = createMemoryFileSystem();
  const bytes = new Uint8Array(256 * 1024);
  for (let index = 0; index < bytes.length; index++) bytes[index] = [255, 0, 10, 65][index % 4]!;
  await memory.writeFile("/input", bytes);
  let opens = 0;
  let closes = 0;
  const fs = intercept(memory, {
    async open(path, options) {
      const descriptor = await memory.open(path, options);
      if (path !== "/input") return descriptor;
      opens++;
      return intercept(descriptor, { async close() {
        closes++;
        await descriptor.close();
        await close?.();
      } });
    },
    readStream() { throw new Error("Canonical input must not use the legacy stream"); },
  });
  const shell = new Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(agentCommands());
  return { shell, memory, bytes, counts: () => ({ opens, closes }) };
}

for (const scriptFile of [false, true]) {
  for (const pipefail of [false, true]) {
    test(`prepared pipeline input returns status and raw bytes: script=${scriptFile}, pipefail=${pipefail}`, { timeout: 3000 }, async context => {
      const { shell, memory, bytes, counts } = await setup();
      context.after(() => shell.dispose());
      const script = `${pipefail ? "set -o pipefail; " : ""}cat </input | head -c32`;
      await memory.writeFile("/workflow.sh", new TextEncoder().encode(script));
      const result = await shell.exec(scriptFile ? "bash /workflow.sh" : script);
      assert.equal(result.exitCode, pipefail ? 141 : 0);
      assert.deepEqual(result.stdoutBytes, bytes.slice(0, 32));
      assert.deepEqual(result.stderrBytes, new Uint8Array());
      assert.deepEqual(counts(), { opens: 1, closes: 1 });
    });
  }

  test(`prepared pipeline input retains stage statuses and subsequent execution: script=${scriptFile}`, { timeout: 3000 }, async context => {
    const { shell, memory, bytes, counts } = await setup();
    context.after(() => shell.dispose());
    const script = "set -e; cat </input | head -c32; printf '%s\\n' \"${PIPESTATUS[@]}\"; printf done";
    await memory.writeFile("/workflow.sh", new TextEncoder().encode(script));
    const result = await shell.exec(scriptFile ? "bash /workflow.sh" : script);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdoutBytes, new Uint8Array([...bytes.slice(0, 32), ...new TextEncoder().encode("141\n0\ndone")]));
    assert.deepEqual(result.stderrBytes, new Uint8Array());
    assert.deepEqual(counts(), { opens: 1, closes: 1 });
  });
}

for (const reason of [undefined, null, false, 0, "", new FsError("EIO"), new FsError("EPIPE")]) {
  test(`prepared pipeline input retains genuine close failure: ${String(reason)}`, { timeout: 3000 }, async context => {
    const { shell, counts } = await setup(() => { throw reason; });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec("cat </input | head -c32"), error => Object.is(error, reason));
    assert.deepEqual(counts(), { opens: 1, closes: 1 });
  });
}

for (const reason of [null, false, 0, ""]) {
  test(`root cancellation during prepared pipeline cleanup retains falsey reason: ${String(reason)}`, { timeout: 3000 }, async context => {
    const controller = new AbortController();
    const { shell, counts } = await setup(() => {
      controller.abort(reason);
      throw new FsError("EIO");
    });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec("cat </input | head -c32", { signal: controller.signal }), error => Object.is(error, reason));
    assert.deepEqual(counts(), { opens: 1, closes: 1 });
  });
}

test("prepared pipeline completion waits for cooperative descriptor teardown", { timeout: 3000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const { shell, counts } = await setup(async () => { entered.resolve(); await release.promise; });
  context.after(() => shell.dispose());
  let settled = false;
  const pending = shell.exec("cat </input | head -c32").finally(() => { settled = true; });
  void pending.catch(() => {});
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes.length, 32);
  assert.deepEqual(result.stderrBytes, new Uint8Array());
  assert.deepEqual(counts(), { opens: 1, closes: 1 });
});
