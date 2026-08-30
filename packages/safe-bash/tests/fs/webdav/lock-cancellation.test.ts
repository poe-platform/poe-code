import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

for (const method of ["copyFile", "rename"] as const) {
  for (const reason of ["caller", "timeout"] as const) {
    test(`${method} cleans up an available LOCK response after acquisition-time ${reason} cancellation`, { timeout: 2000 }, async () => {
      const mock = new MockDav();
      mock.files.set("/source", new Uint8Array([1]));
      mock.files.set("/target", new Uint8Array([2]));
      const controller = new AbortController();
      let cancelled = false;
      let disposed!: () => void;
      const disposal = new Promise<void>(resolve => { disposed = resolve; });
      let unlocked!: () => void;
      const unlocking = new Promise<void>(resolve => { unlocked = resolve; });
      let lockSignal: AbortSignal | null | undefined;
      const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: 30, fetch: async (url, init) => {
        const response = await mock.fetch(url, init);
        if (init.method === "UNLOCK") unlocked();
        if (init.method !== "LOCK") return response;
        lockSignal = init.signal;
        await response.body?.cancel();
        if (reason === "caller") controller.abort();
        else await delay(60);
        return new Response(new ReadableStream({ cancel() { cancelled = true; disposed(); } }), {
          status: response.status, headers: response.headers,
        });
      } });
      await assert.rejects(fs[method]("/source", "/target", { signal: controller.signal }), {
        code: reason === "caller" ? "ECANCELED" : "ETIMEDOUT", syscall: "LOCK", path: "/target",
      });
      await Promise.all([disposal, unlocking]);
      assert.equal(cancelled, true);
      assert.equal(mock.locks.size, 0);
      assert.deepEqual(mock.requests.map(({ init }) => init.method), ["PROPFIND", "PROPFIND", "LOCK", "UNLOCK"]);
      const cleanup = mock.requests.at(-1)!;
      assert.notEqual(cleanup.init.signal, lockSignal);
      assert.equal(cleanup.init.signal!.aborted, false);
      assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
      assert.deepEqual(mock.files.get("/target"), new Uint8Array([2]));
    });
  }
}

for (const reason of ["caller", "timeout"] as const) {
  test(`LOCK body acquisition ${reason} cancellation releases its reader and lock`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/target", new Uint8Array([2]));
    const controller = new AbortController();
    let cancelled = false;
    let body: ReadableStream<Uint8Array> | undefined;
    let trigger: Promise<void> | undefined;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: 30, fetch: async (url, init) => {
      const response = await mock.fetch(url, init);
      if (init.method !== "LOCK") return response;
      await response.body?.cancel();
      body = new ReadableStream<Uint8Array>({
        pull() {
          trigger ??= delay(reason === "caller" ? 5 : 60).then(() => {
            if (reason === "caller") controller.abort();
          });
        },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, headers: response.headers });
    } });
    await assert.rejects(fs.copyFile("/source", "/target", { signal: controller.signal }), {
      code: reason === "caller" ? "ECANCELED" : "ETIMEDOUT",
    });
    await trigger;
    assert.equal(cancelled, true);
    assert.equal(body!.locked, false);
    assert.equal(mock.locks.size, 0);
    assert.equal(mock.requests.at(-1)!.init.method, "UNLOCK");
    assert.equal(mock.requests.some(({ init }) => init.method === "COPY"), false);
  });
}

for (const invalid of ["missing-token", "invalid-token", "foreign-url", "wrong-path", "redirected", "opaque-redirect"] as const) {
  test(`acquisition cancellation does not trust a ${invalid} LOCK response`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/target", new Uint8Array([2]));
    const controller = new AbortController();
    const methods: (string | undefined)[] = [];
    let cancelled = false;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
      methods.push(init.method);
      if (init.method !== "LOCK") return mock.fetch(url, init);
      const headers = new Headers({ "Lock-Token": "<urn:uuid:untrusted>" });
      if (invalid === "missing-token") headers.delete("Lock-Token");
      if (invalid === "invalid-token") headers.set("Lock-Token", "<urn:uuid:one> <urn:uuid:two>");
      const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers });
      if (invalid === "foreign-url") Object.defineProperty(response, "url", { value: "https://foreign.test/dav/target" });
      if (invalid === "wrong-path") Object.defineProperty(response, "url", { value: "https://example.test/dav/other" });
      if (invalid === "redirected") Object.defineProperty(response, "redirected", { value: true });
      if (invalid === "opaque-redirect") Object.defineProperty(response, "type", { value: "opaqueredirect" });
      controller.abort();
      return response;
    } });
    await assert.rejects(fs.copyFile("/source", "/target", { signal: controller.signal }), { code: "ECANCELED" });
    assert.equal(cancelled, true);
    assert.deepEqual(methods, ["PROPFIND", "PROPFIND", "LOCK"]);
    assert.equal(mock.locks.size, 0);
  });
}

test("acquisition cancellation bounds best-effort UNLOCK with a fresh deadline", async () => {
  const mock = new MockDav();
  mock.files.set("/source", new Uint8Array([1]));
  mock.files.set("/target", new Uint8Array([2]));
  const controller = new AbortController();
  let cleanupSignal: AbortSignal | null | undefined;
  let cleanup: Promise<void> | undefined;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: 30, fetch: async (url, init) => {
    if (init.method === "UNLOCK") {
      cleanupSignal = init.signal;
      assert.equal(cleanupSignal!.aborted, false);
      cleanup = delay(60);
      await new Promise<void>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    }
    const response = await mock.fetch(url, init);
    if (init.method === "LOCK") controller.abort();
    return response;
  } });
  await assert.rejects(fs.copyFile("/source", "/target", { signal: controller.signal }), { code: "ECANCELED" });
  await cleanup;
  assert.equal(cleanupSignal?.aborted, true);
  assert.equal(mock.locks.size, 1);
  assert.equal(mock.requests.some(({ init }) => init.method === "COPY"), false);
});
