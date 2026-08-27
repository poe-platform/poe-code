import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResult } from "../../src/contracts/index.js";
import { writeText } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((accept) => { resolve = accept; });
  return { promise, resolve };
}

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

for (const pipefail of [false, true]) {
  for (const failCleanup of [false, true]) {
    test(`early downstream closure drains both owners; pipefail=${pipefail}, failure=${failCleanup}`, { timeout: 2000 }, async () => {
      const { shell, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
      const cleanupFailure = new Error("producer cleanup");
      const done = new Set<string>();
      const bytes: number[] = [];
      commands.register({ name: "producer", async execute(context) {
        context.registerCleanup!(async () => { await delay(); done.add("producer"); if (failCleanup) throw cleanupFailure; });
        for (let index = 0; index < 200; index++) await context.stdout.write(Uint8Array.from([97, 98, 10]));
        return { exitCode: 0 };
      } });
      commands.register({ name: "first", async execute(context) {
        context.registerCleanup!(async () => { await delay(); done.add("first"); });
        for await (const chunk of context.stdin) { await context.stdout.write(chunk); break; }
        return { exitCode: 0 };
      } });
      const execution = shell.exec(`${pipefail ? "set -o pipefail; " : ""}producer | first`, { stdout: { async write(chunk) { bytes.push(...chunk); } } });
      if (failCleanup) await assert.rejects(execution, (error: unknown) => error === cleanupFailure);
      else {
        const result = await execution;
        assert.equal(result.exitCode, pipefail ? 141 : 0);
        assert.equal(result.stdout, "ab\n");
        assert.equal(result.stderr, "");
      }
      assert.deepEqual(bytes, [97, 98, 10]);
      assert.deepEqual([...done].sort(), ["first", "producer"]);
      await shell.dispose();
      assert.equal(done.size, 2);
    });
  }
}

test("pipeline abort drains nested owners even when every handler remains opaque", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const entries = [deferred(), deferred()];
  const done = new Set<string>();
  commands.register({ name: "parent", execute(context) { return context.invoke!("nested", []); } });
  commands.register({ name: "nested", execute(context) {
    context.registerCleanup!(async () => { await delay(); done.add("nested"); });
    entries[0]!.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  commands.register({ name: "consumer", execute(context) {
    context.registerCleanup!(async () => { await delay(); done.add("consumer"); });
    entries[1]!.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const reason = new Error("caller");
  const execution = assert.rejects(shell.exec("parent | consumer", { signal: controller.signal }), (error: unknown) => error === reason);
  await Promise.all(entries.map((entry) => entry.promise));
  controller.abort(reason);
  await execution;
  assert.deepEqual([...done].sort(), ["consumer", "nested"]);
  await shell.dispose();
});

test("opaque pending input and iterator return do not delay owned cleanup on cancel", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const reading = deferred();
  let done = false;
  let returns = 0;
  commands.register({ name: "reader", async execute(context) {
    context.registerCleanup!(async () => { await delay(); done = true; });
    for await (const chunk of context.stdin) await context.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  const reason = new Error("caller");
  const execution = assert.rejects(shell.exec("reader", {
    signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() { return {
      next() { reading.resolve(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
      return() { returns++; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    }; } },
  }), (error: unknown) => error === reason);
  await reading.promise;
  controller.abort(reason);
  await execution;
  assert.equal(done, true);
  assert.equal(returns, 1);
  await shell.dispose();
});

test("opaque sink rejection is observed without skipping cleanup or altering captured bytes", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const writing = deferred();
  const bytes: number[] = [];
  let done = false;
  let rejectWrite!: (reason: unknown) => void;
  const pending = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  commands.register({ name: "writer", async execute(context) {
    context.registerCleanup!(async () => { await delay(); done = true; });
    await context.stdout.write(Uint8Array.from([239, 187, 191, 0, 255]));
    return { exitCode: 0 };
  } });
  const reason = new Error("caller");
  const execution = assert.rejects(shell.exec("writer", { signal: controller.signal, stdout: { write(chunk) {
    bytes.push(...chunk); writing.resolve(); return pending;
  } } }), (error: unknown) => error === reason);
  await writing.promise;
  controller.abort(reason);
  await execution;
  assert.equal(done, true);
  assert.deepEqual(bytes, [239, 187, 191, 0, 255]);
  rejectWrite(new Error("late sink"));
  await delay();
  await shell.dispose();
});

for (const source of [
  "owned | pass", "(owned)", "f() { owned; }; f", "eval owned", ". /owned.sh", "source /owned.sh", "say $(owned)", "bash -c owned", "command owned",
]) {
  test(`registered cleanup follows ${source}`, { timeout: 2000 }, async () => {
    const { shell, commands, fs } = setup();
    await fs.writeFile("/owned.sh", new TextEncoder().encode("owned"));
    let calls = 0;
    commands.register({ name: "owned", async execute(context) {
      context.registerCleanup!(async () => { await delay(); calls++; });
      await writeText(context.stdout, "owned\n");
      return { exitCode: 0 };
    } });
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "owned\n");
    assert.equal(result.stderr, "");
    assert.equal(calls, 1);
    await shell.dispose();
    assert.equal(calls, 1);
  });
}

test("pipeline output and shared output accounting preserve exact bytes after delayed drain", { timeout: 2000 }, async () => {
  const { shell, commands } = setup({ limits: { maxOutputBytes: 10 } });
  let done = false;
  commands.register({ name: "writer", async execute(context) {
    context.registerCleanup!(async () => { await delay(); done = true; });
    await context.stdout.write(Uint8Array.from([239, 187, 191, 0, 255]));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("writer | pass");
  assert.deepEqual([...result.stdoutBytes], [239, 187, 191, 0, 255]);
  assert.equal(result.stdout.charCodeAt(0), 0xfeff);
  assert.equal(result.exitCode, 0);
  assert.equal(done, true);
  await assert.rejects(shell.exec("writer | pass", { limits: { maxOutputBytes: 9 } }), /maxOutputBytes/);
  await shell.dispose();
});
