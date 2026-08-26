import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { assertBytes, bytes, cwd, deferred, deletion, drain, instrument, invoke, memory, replacement, snapshot } from "./helpers.js";

for (const tool of ["diff", "patch"] as const) {
  for (const reason of [new Error("preflight abort"), { token: "abort-object" }, "abort-string", null, 0, false]) {
    test(`${tool} preserves exact pre-abort reason ${String(reason)} without any FS access`, async () => {
      const backing = await memory({ target: "old\n", desired: "new\n" });
      const before = await snapshot(backing);
      const observed = instrument(backing);
      const controller = new AbortController();
      controller.abort(reason);
      await assert.rejects(invoke(observed.fs, tool, { args: tool === "diff" ? ["target", "desired"] : [], input: replacement(), signal: controller.signal }), error => error === reason);
      assert.deepEqual(observed.calls, []);
      assert.deepEqual(await snapshot(backing), before);
    });
  }
}

for (const method of ["lstat", "readFile", "readStream"] as const) {
  test(`atomic extension blocked ${method} aborts without effects and observes late host rejection`, { timeout: 4000 }, async () => {
    const backing = await memory({ first: "old\n", second: "old\n" });
    const before = await snapshot(backing);
    const entered = deferred<void>();
    const blocked = deferred<void>();
    const reason = { at: method };
    const controller = new AbortController();
    const observed = instrument(backing, {
      streaming: method === "readStream",
      async before(call) {
        assert.equal(call.signal, controller.signal);
        if (call.method !== method || call.path !== `${cwd}/second`) return;
        entered.resolve();
        await blocked.promise;
      },
    });
    const running = invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + replacement("second"), signal: controller.signal });
    const rejected = assert.rejects(running, error => error === reason);
    try {
      await entered.promise;
      controller.abort(reason);
      await rejected;
      assert.deepEqual(observed.mutations(), []);
      assert.deepEqual(await snapshot(backing), before);
    } finally {
      controller.abort(reason);
      blocked.reject(new Error("late read rejection"));
      await drain();
    }
  });
}

test("blocked stdin next and cleanup return cannot replace the abort reason", { timeout: 4000 }, async () => {
  const backing = await memory();
  const before = await snapshot(backing);
  const entered = deferred<void>();
  const cleanupEntered = deferred<void>();
  const next = deferred<IteratorResult<Uint8Array>>();
  const cleanup = deferred<IteratorResult<Uint8Array>>();
  const input: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next() { entered.resolve(); return next.promise; },
        return() { cleanupEntered.resolve(); return cleanup.promise; },
      };
    },
  };
  const controller = new AbortController();
  const reason = Symbol("stdin cancellation");
  const observed = instrument(backing);
  const running = invoke(observed.fs, "patch", { input, signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  try {
    await entered.promise;
    controller.abort(reason);
    await rejected;
    await cleanupEntered.promise;
    assert.deepEqual(observed.calls, []);
    assert.deepEqual(await snapshot(backing), before);
  } finally {
    controller.abort(reason);
    next.reject(new Error("late next failure"));
    cleanup.reject(new Error("late cleanup failure"));
    await drain();
  }
});

for (const method of ["writeFile", "rm"] as const) {
  test(`abort blocked ${method} leaves only successful prefix and no cleanup writes`, { timeout: 4000 }, async () => {
    const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
    const entered = deferred<void>();
    const blocked = deferred<void>();
    const controller = new AbortController();
    const reason = new Error(`stop ${method}`);
    const observed = instrument(backing, {
      async before(call) {
        assert.equal(call.signal, controller.signal);
        if (call.method === method && call.path === `${cwd}/second`) {
          entered.resolve();
          await blocked.promise;
        }
      },
    });
    const input = replacement("first") + (method === "rm" ? deletion("second") : replacement("second")) + replacement("third");
    const rejected = assert.rejects(invoke(observed.fs, "patch", { input, signal: controller.signal }), error => error === reason);
    try {
      await entered.promise;
      controller.abort(reason);
      await rejected;
      await assertBytes(backing, "first", "new\n");
      await assertBytes(backing, "second", "old\n");
      await assertBytes(backing, "third", "old\n");
      assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), [["writeFile", `${cwd}/first`], [method, `${cwd}/second`]]);
    } finally {
      controller.abort(reason);
      blocked.reject(new Error("late commit failure"));
      await drain();
    }
  });
}

test("uncooperative in-flight write can finish after cancellation, but later files never start", { timeout: 4000 }, async () => {
  const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
  const entered = deferred<void>();
  const blocked = deferred<void>();
  const finished = deferred<void>();
  const controller = new AbortController();
  const reason = { stop: "publication" };
  const observed = instrument(backing, {
    async before(call) {
      if (call.method !== "writeFile" || call.path !== `${cwd}/second`) return;
      entered.resolve();
      await blocked.promise;
      await backing.writeFile(call.path, bytes("late host side effect\n"));
      finished.resolve();
    },
  });
  const rejected = assert.rejects(invoke(observed.fs, "patch", { input: replacement("first") + replacement("second") + replacement("third"), signal: controller.signal }), error => error === reason);
  try {
    await entered.promise;
    controller.abort(reason);
    await rejected;
    await assertBytes(backing, "first", "new\n");
    await assertBytes(backing, "second", "old\n");
    blocked.resolve();
    await finished.promise;
    await drain();
    await assertBytes(backing, "second", "late host side effect\n");
    await assertBytes(backing, "third", "old\n");
    assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/first`, `${cwd}/second`]);
  } finally {
    controller.abort(reason);
    blocked.resolve();
    await drain();
  }
});

test("abort immediately after first publication preserves that side effect and exact reason", async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const controller = new AbortController();
  const reason = { stop: "after publication" };
  const observed = instrument(backing, {
    after(call) { if (call.method === "writeFile") controller.abort(reason); },
  });
  await assert.rejects(invoke(observed.fs, "patch", { input: replacement("first") + replacement("second"), signal: controller.signal }), error => error === reason);
  await drain();
  await assertBytes(backing, "first", "new\n");
  await assertBytes(backing, "second", "old\n");
  assert.equal(observed.mutations().length, 1);
});

for (const mode of ["dry-run", "status", "diagnostic"] as const) {
  test(`atomic extension abort blocked ${mode} sink preserves the corresponding target state`, { timeout: 4000 }, async () => {
    const backing = await memory();
    const before = await snapshot(backing);
    const entered = deferred<void>();
    const blocked = deferred<void>();
    const controller = new AbortController();
    const reason = { mode };
    const sink = { async write() { entered.resolve(); await blocked.promise; } };
    const observed = instrument(backing);
    const rejected = assert.rejects(invoke(observed.fs, "patch", {
      input: mode === "diagnostic" ? "not a patch\n" : replacement(),
      args: mode === "dry-run" ? ["--atomic", "--dry-run"] : ["--atomic"], signal: controller.signal,
      ...(mode === "diagnostic" ? { stderr: sink } : { stdout: sink }),
    }), error => error === reason);
    try {
      await entered.promise;
      controller.abort(reason);
      await rejected;
      if (mode === "status") { await assertBytes(backing, "target", "new\n"); assert.equal(observed.mutations().length, 1); }
      else { assert.deepEqual(await snapshot(backing), before); assert.deepEqual(observed.mutations(), []); }
    } finally {
      controller.abort(reason);
      blocked.reject(new Error("late sink failure"));
      await drain();
    }
  });
}
