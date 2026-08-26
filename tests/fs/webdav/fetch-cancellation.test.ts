import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

function gate<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function bounded<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("outward settlement exceeded 500ms")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

for (const method of ["PROPFIND", "GET"] as const) {
  for (const cancellation of ["caller", "timeout"] as const) {
    for (const completion of ["resolve", "reject"] as const) {
      test(`${method} ignoring ${cancellation} settles before late fetch ${completion}`, { timeout: 2000 }, async () => {
        const mock = new MockDav();
        mock.files.set("/input", new Uint8Array([1, 2]));
        const entered = gate<AbortSignal>();
        const pending = gate<Response>();
        const controller = new AbortController();
        const reason = new Error("specific caller reason");
        const methods: string[] = [];
        let returned = false;
        const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: cancellation === "timeout" ? 25 : 1000,
          fetch: async (url, init) => {
            methods.push(init.method!);
            if (init.method !== method) return mock.fetch(url, init);
            entered.resolve(init.signal!);
            try { return await pending.promise; }
            finally { returned = true; }
          },
        });
        const reading = method === "GET" ? fs.readStream("/input", { signal: controller.signal }).next()
          : fs.readFile("/input", { signal: controller.signal });
        const outcome = reading.then(() => assert.fail("unexpected success"), (error: unknown) => error);
        const signal = await bounded(entered.promise);
        assert.equal(getEventListeners(signal, "abort").length, 1);
        if (cancellation === "caller") controller.abort(reason);
        try {
          const error = await bounded(outcome);
          assert.ok(error instanceof FsError);
          assert.equal(error.code, cancellation === "caller" ? "ECANCELED" : "ETIMEDOUT");
          assert.equal(error.syscall, method);
          assert.equal(error.path, "/input");
          assert.equal(error.cause, cancellation === "caller" ? reason : signal.reason);
          assert.equal(returned, false);
          assert.equal(signal.aborted, true);
          assert.equal(getEventListeners(signal, "abort").length, 0);
          assert.equal(getEventListeners(controller.signal, "abort").length, 0);
        } finally {
          if (completion === "reject") pending.reject(new Error("late transport rejection"));
          else {
            const disposed = gate();
            let pulls = 0;
            const body = new ReadableStream<Uint8Array>({
              pull() { pulls++; },
              cancel(value) { assert.equal(value, signal.reason); disposed.resolve(); },
            }, { highWaterMark: 0 });
            pending.resolve(new Response(body, method === "PROPFIND"
              ? { status: 301, headers: { Location: "https://example.test/dav/input/" } } : {}));
            await bounded(disposed.promise);
            assert.equal(pulls, 0);
            assert.equal(body.locked, false);
          }
          await turn();
        }
        assert.equal(returned, true);
        assert.equal(getEventListeners(signal, "abort").length, 0);
        assert.deepEqual(methods, method === "GET" ? ["PROPFIND", "GET"] : ["PROPFIND"]);
        assert.deepEqual(mock.files.get("/input"), new Uint8Array([1, 2]));
      });
    }
  }
}

for (const cleanup of ["resolve", "reject"] as const) {
  test(`late response cancel may remain pending then ${cleanup} without blocking outward settlement`, { timeout: 2000 }, async () => {
    const entered = gate();
    const pending = gate<Response>();
    const disposed = gate();
    const cancel = gate();
    const controller = new AbortController();
    const reason = { cancellation: "object identity" };
    let pulls = 0;
    let cancels = 0;
    const body = new ReadableStream<Uint8Array>({
      pull() { pulls++; },
      cancel(value) {
        assert.equal(value, reason);
        cancels++;
        disposed.resolve();
        return cancel.promise;
      },
    }, { highWaterMark: 0 });
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: () => {
      entered.resolve();
      return pending.promise;
    } });
    const reading = assert.rejects(fs.stat("/input", { signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "ECANCELED");
      assert.equal(error.cause, reason);
      return true;
    });
    await bounded(entered.promise);
    controller.abort(reason);
    await bounded(reading);
    pending.resolve(new Response(body));
    await bounded(disposed.promise);
    assert.equal(cancels, 1);
    assert.equal(pulls, 0);
    assert.equal(body.locked, false);
    if (cleanup === "reject") cancel.reject(new Error("late cancel rejection"));
    else cancel.resolve();
    await turn();
  });
}

test("normal success and HTTP failure release fetch listeners and bodies", async () => {
  const mock = new MockDav();
  const signals: AbortSignal[] = [];
  const bodies: ReadableStream<Uint8Array>[] = [];
  mock.files.set("/input", new Uint8Array([0, 255]));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    signals.push(init.signal!);
    const response = await mock.fetch(url, init);
    if (response.body) bodies.push(response.body);
    return response;
  } });
  assert.deepEqual(await fs.readFile("/input"), new Uint8Array([0, 255]));
  await assert.rejects(fs.stat("/missing"), { code: "ENOENT", syscall: "PROPFIND", path: "/missing" });
  assert.ok(signals.every(signal => getEventListeners(signal, "abort").length === 0));
  assert.ok(bodies.every(body => !body.locked));
});

for (const failure of ["throw", "reject", "cooperative-abort"] as const) {
  test(`${failure} preserves error translation, cause and listener cleanup`, async () => {
    const controller = new AbortController();
    const reason = new Error(failure);
    let signal: AbortSignal | undefined;
    const entered = gate();
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: (_url, init) => {
      signal = init.signal!;
      entered.resolve();
      if (failure === "throw") throw reason;
      if (failure === "reject") return Promise.reject(reason);
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      });
    } });
    const reading = assert.rejects(fs.stat("/input", { signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, failure === "cooperative-abort" ? "ECANCELED" : "EIO");
      assert.equal(error.cause, reason);
      assert.equal(error.path, "/input");
      assert.equal(error.syscall, "PROPFIND");
      return true;
    });
    await entered.promise;
    if (failure === "cooperative-abort") controller.abort(reason);
    await bounded(reading);
    assert.equal(getEventListeners(signal!, "abort").length, 0);
  });
}

test("pre-abort preserves existing ECANCELED shape and starts no transport", async () => {
  const controller = new AbortController();
  controller.abort(new Error("pre-abort"));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: () => assert.fail("unexpected transport") });
  await assert.rejects(fs.stat("/input", { signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "ECANCELED");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("accepted MOVE effect is not rolled back when an ignored fetch resolves after cancellation", { timeout: 2000 }, async () => {
  const mock = new MockDav();
  mock.files.set("/source", new Uint8Array([7]));
  const accepted = gate<Response>();
  const pending = gate<Response>();
  const controller = new AbortController();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    const response = await mock.fetch(url, init);
    if (init.method !== "MOVE") return response;
    accepted.resolve(response);
    return pending.promise;
  } });
  const moving = assert.rejects(fs.rename("/source", "/target", { signal: controller.signal }), { code: "ECANCELED", syscall: "MOVE" });
  const response = await bounded(accepted.promise);
  controller.abort();
  try {
    await bounded(moving);
    assert.equal(mock.files.has("/source"), false);
    assert.deepEqual(mock.files.get("/target"), new Uint8Array([7]));
  } finally { pending.resolve(response); await turn(); }
  assert.deepEqual(mock.requests.map(request => request.init.method), ["PROPFIND", "PROPFIND", "MOVE"]);
});

for (const cleanup of ["success", "ignores-signal"] as const) {
  test(`late LOCK response starts only best-effort UNLOCK with ${cleanup}`, { timeout: 2000 }, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/target", new Uint8Array([2]));
    const locked = gate<Response>();
    const pending = gate<Response>();
    const unlocking = gate<AbortSignal>();
    const unlockPending = gate<Response>();
    const unlocked = gate();
    const disposed = gate();
    const controller = new AbortController();
    const methods: string[] = [];
    let lockSignal: AbortSignal | undefined;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: 25, fetch: async (url, init) => {
      methods.push(init.method!);
      if (init.method === "UNLOCK") {
        assert.equal(init.signal!.aborted, false);
        unlocking.resolve(init.signal!);
        if (cleanup === "ignores-signal") return unlockPending.promise;
      }
      const response = await mock.fetch(url, init);
      if (init.method === "UNLOCK") unlocked.resolve();
      if (init.method !== "LOCK") return response;
      lockSignal = init.signal!;
      locked.resolve(response);
      return pending.promise;
    } });
    const copying = assert.rejects(fs.copyFile("/source", "/target", { signal: controller.signal }), { code: "ECANCELED", syscall: "LOCK" });
    const response = await bounded(locked.promise);
    controller.abort();
    await bounded(copying);
    assert.equal(mock.locks.size, 1);
    assert.deepEqual(methods, ["PROPFIND", "PROPFIND", "LOCK"]);
    await response.body?.cancel();
    const body = new ReadableStream<Uint8Array>({ cancel() { disposed.resolve(); } }, { highWaterMark: 0 });
    pending.resolve(new Response(body, { status: response.status, headers: response.headers }));
    const signal = await bounded(unlocking.promise);
    await bounded(disposed.promise);
    assert.notEqual(signal, lockSignal);
    if (cleanup === "success") {
      await bounded(unlocked.promise);
      await turn();
      assert.equal(mock.locks.size, 0);
    } else {
      await bounded(new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })));
      await turn();
      assert.equal(getEventListeners(signal, "abort").length, 0);
      assert.equal(mock.locks.size, 1);
      unlockPending.reject(new Error("late UNLOCK rejection"));
      await turn();
    }
    assert.equal(body.locked, false);
    assert.deepEqual(methods, ["PROPFIND", "PROPFIND", "LOCK", "UNLOCK"]);
    assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
    assert.deepEqual(mock.files.get("/target"), new Uint8Array([2]));
  });
}
