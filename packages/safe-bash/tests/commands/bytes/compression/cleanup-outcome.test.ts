import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import {
  CommandRegistry,
  type CommandContext,
  type InvocationCleanup,
} from "../../../../src/contracts/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { FileOperation } from "../../../../src/commands/bytes/compression/file-operation.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const cleanupFailure of [false, 0, "", null, undefined]) {
  test(`command aggregate retains falsey cleanup reason ${JSON.stringify(cleanupFailure)} without root replay`, async (context) => {
    const fs = new MemoryFileSystem(),
      seen: unknown[] = [];
    const failure = new TypeError("private write failure");
    const shell = new Shell({
      fs,
      commands: new CommandRegistry(createCompressionCommands()),
      onInternalError(error) {
        seen.push(error);
      },
    });
    context.after(() => shell.dispose());
    await fs.writeFile("/input", Uint8Array.of(65));
    const lstat = fs.lstat.bind(fs);
    let staged = "";
    context.mock.method(fs, "writeStream", async (path: string) => {
      staged = path;
      throw failure;
    });
    context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
      if (staged && args[0] === staged.slice(0, staged.lastIndexOf("/"))) throw cleanupFailure;
      return lstat(...args);
    });
    const result = await shell.exec("gzip /input");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "gzip: compression failed and staging cleanup failed; input retained\n");
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof AggregateError);
    assert.equal(seen[0].errors.length, 2);
    assert.equal(seen[0].errors[0], failure);
    assert.ok(Object.is(seen[0].errors[1], cleanupFailure));
    assert.deepEqual(await fs.readFile("/input"), Uint8Array.of(65));
  });
}

for (const cancelled of [false, true]) {
  test(`held failing cleanup drains before ${cancelled ? "false cancellation" : "handled command outcome"}`, async (context) => {
    const fs = new MemoryFileSystem(),
      entered = deferred(),
      release = deferred(),
      controller = new AbortController();
    const failure = new Error("write private"),
      cleanupFailure = new Error("cleanup private"),
      seen: unknown[] = [];
    const shell = new Shell({
      fs,
      commands: new CommandRegistry(createCompressionCommands()),
      onInternalError(error) {
        seen.push(error);
      },
    });
    await fs.writeFile("/input", Uint8Array.of(65));
    const lstat = fs.lstat.bind(fs);
    let staged = "",
      settled = false;
    context.mock.method(fs, "writeStream", async (path: string) => {
      staged = path;
      throw failure;
    });
    context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
      if (staged && args[0] === staged.slice(0, staged.lastIndexOf("/"))) {
        entered.resolve();
        await release.promise;
        throw cleanupFailure;
      }
      return lstat(...args);
    });
    const pending = shell.exec("gzip /input", { signal: controller.signal }).then(
      (value) => ({ value }),
      (reason) => ({ reason }),
    );
    void pending.then(() => {
      settled = true;
    });
    try {
      await entered.promise;
      if (cancelled) controller.abort(false);
      await setImmediate();
      await setImmediate();
      assert.equal(settled, false);
      release.resolve();
      const outcome = await pending;
      if (cancelled) assert.deepEqual(outcome, { reason: false });
      else {
        assert.ok("value" in outcome);
        assert.equal(outcome.value.exitCode, 1);
        assert.equal(seen.length, 1);
      }
    } finally {
      release.resolve();
      await pending;
      await shell.dispose();
    }
  });
}

test("unclaimed registered retirement reports failure and explicit close preserves promise identity", async () => {
  const failure = { private: "cleanup" };
  let callback: InvocationCleanup | undefined;
  const context: CommandContext = {
    command: "gzip",
    args: [],
    cwd: "/",
    env: {},
    fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} },
    stderr: { async write() {} },
    registerCleanup(cleanup) {
      callback = cleanup;
    },
  };
  const operation = new FileOperation(context, async () => {
    throw failure;
  });
  assert.ok(callback);
  let settled = false;
  const registered = Promise.resolve(callback());
  void registered.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    const outcome = await Promise.race([
      registered.then(
        () => ({ kind: "resolved" }),
        (error) => ({ kind: "rejected", error }),
      ),
      setImmediate().then(() => ({ kind: "pending" })),
    ]);
    assert.deepEqual(outcome, { kind: "rejected", error: failure });
    assert.equal(settled, true, "unclaimed retirement failure must surface without awaiting a future claim");
  } finally {
    const close = operation.close();
    assert.equal(operation.close(), close);
    await assert.rejects(close, (error) => error === failure);
    await registered.catch(() => {});
  }
});

test("failed construction cannot silently consume unclaimed retirement failure", async () => {
  const failure = { private: "unclaimed cleanup" };
  let registered: Promise<void> | undefined;
  const context: CommandContext = {
    command: "gzip",
    args: [],
    cwd: "/",
    env: {},
    fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} },
    stderr: { async write() {} },
    registerCleanup(cleanup) {
      registered = Promise.resolve(cleanup());
      void registered.catch(() => {});
    },
  };
  assert.throws(
    () =>
      new FileOperation(context, async () => {
        throw failure;
      }),
  );
  assert.ok(registered);
  await assert.rejects(registered, (error) => error === failure);
});

test("internal caller abort leaves held cleanup failure unclaimed at registered barrier", async () => {
  const controller = new AbortController(),
    entered = deferred(),
    release = deferred();
  let callback: InvocationCleanup | undefined;
  const context: CommandContext = {
    command: "gzip",
    args: [],
    cwd: "/",
    env: {},
    fs: new MemoryFileSystem(),
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} },
    stderr: { async write() {} },
    registerCleanup(cleanup) {
      callback = cleanup;
    },
  };
  const operation = new FileOperation(context, async () => {
    entered.resolve();
    await release.promise;
    throw 0;
  });
  assert.ok(callback);
  controller.abort(false);
  await entered.promise;
  const registered = Promise.resolve(callback());
  assert.equal(callback(), registered);
  let settled = false;
  const outcome = registered.then(
    () => ({ resolved: true }),
    (reason) => ({ reason }),
  );
  void outcome.then(() => {
    settled = true;
  });
  try {
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(operation.signal.reason, false);
    release.resolve();
    assert.deepEqual(await outcome, { reason: 0 });
  } finally {
    release.resolve();
    await outcome;
    await assert.rejects(operation.close(), (reason) => reason === 0);
  }
});
