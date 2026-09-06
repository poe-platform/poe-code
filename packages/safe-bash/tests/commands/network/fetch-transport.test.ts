import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, toByteSource } from "../../../src/contracts/index.js";
import { createFetchTransport } from "../../../src/commands/network/index.js";
import { createFetchTransport as createBrowserFetchTransport, cloudflareWorkerLimits } from "../../../src/browser.js";
import { CurlError, type HttpResponse } from "../../../src/commands/network/types.js";

test("browser entry exposes Worker-safe transport and limits", () => {
  assert.equal(typeof createBrowserFetchTransport(), "function");
  assert.ok(cloudflareWorkerLimits.maxOutputBytes <= 4 * 1024 * 1024);
});

test("fetch transport streams request and response without ambient credentials", async () => {
  let request: Request | undefined;
  const transport = createFetchTransport({
    fetch: async input => {
      assert.ok(input instanceof Request);
      request = input;
      assert.equal(await input.text(), "upload");
      return new Response("reply", { status: 201, statusText: "Created", headers: [["x-test", "ok"]] });
    },
  });
  const response = await transport({
    url: "https://allowed.test/data", method: "POST", headers: [["x-input", "yes"]],
    body: toByteSource(new TextEncoder().encode("upload")), signal: new AbortController().signal,
  });
  assert.equal(request?.credentials, "omit");
  assert.equal(response.status, 201);
  assert.equal(new TextDecoder().decode(await collectBytes(response.body, { maxBytes: 1024 })), "reply");
  await response.dispose();
});

test("fetch transport rejects unsupported protocols before fetch", async () => {
  let calls = 0;
  const transport = createFetchTransport({ fetch: async () => { calls++; return new Response(); } });
  await assert.rejects(transport({ url: "file:///secret", method: "GET", headers: [], signal: new AbortController().signal }), /Unsupported protocol/);
  assert.equal(calls, 0);
});

for (const [entry, factory] of [["network", createFetchTransport], ["browser", createBrowserFetchTransport]] as const) {
  for (const url of ["http://public.example/upload", "https://127.0.0.1/upload"]) {
    test(`${entry} fetch fails closed before constructing flagged fetch requests: ${url}`, async () => {
      const calls = { fetch: 0, body: 0, iterator: 0, next: 0, request: 0, stream: 0, headers: 0, cleanup: 0 };
      const NativeRequest = Request;
      const NativeStream = ReadableStream;
      const NativeHeaders = Headers;
      globalThis.Request = new Proxy(NativeRequest, { construct(target, args) { calls.request++; return Reflect.construct(target, args); } });
      globalThis.ReadableStream = new Proxy(NativeStream, { construct(target, args) { calls.stream++; return Reflect.construct(target, args); } });
      globalThis.Headers = new Proxy(NativeHeaders, { construct(target, args) { calls.headers++; return Reflect.construct(target, args); } });
      let response: HttpResponse | undefined;
      const transport = factory({ fetch: async () => { calls.fetch++; return new Response(null, { status: 204 }); } });
      try {
        assert.equal(Reflect.get(transport, "supportsPrivateNetworkDeny"), undefined);
        await assert.rejects(transport({
          url, method: "POST", headers: [], signal: new AbortController().signal, denyPrivateNetworks: true,
          get body() { calls.body++; return { [Symbol.asyncIterator]() { calls.iterator++; return { async next() { calls.next++; return { done: true as const, value: undefined }; } }; } }; },
          registerCleanup() { calls.cleanup++; },
        }).then(value => { response = value; return value; }), error => error instanceof CurlError && error.exitCode === 7);
        assert.deepEqual(calls, { fetch: 0, body: 0, iterator: 0, next: 0, request: 0, stream: 0, headers: 0, cleanup: 0 });
      } finally { await response?.dispose(); globalThis.Request = NativeRequest; globalThis.ReadableStream = NativeStream; globalThis.Headers = NativeHeaders; }
    });
  }
}

for (const reason of [undefined, null, false, 0, "", NaN]) test(`flagged fetch preserves pre-abort reason before URL or body inspection: ${String(reason)}`, async () => {
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  const transport = createFetchTransport({ fetch: async () => { calls++; return new Response(); } });
  await assert.rejects(transport({
    get url(): string { return assert.fail("aborted request must not inspect its URL"); },
    method: "POST", headers: [], signal: controller.signal, denyPrivateNetworks: true,
    get body(): never { return assert.fail("aborted request must not inspect its body"); },
  }), error => Object.is(error, controller.signal.reason));
  assert.equal(calls, 0);
});

test("flagged fetch preserves protocol-validation precedence without touching the body", async () => {
  let calls = 0;
  const transport = createFetchTransport({ fetch: async () => { calls++; return new Response(); } });
  await assert.rejects(transport({
    url: "file:///secret", method: "POST", headers: [], signal: new AbortController().signal, denyPrivateNetworks: true,
    get body(): never { return assert.fail("unsupported protocol must not inspect its body"); },
  }), error => error instanceof CurlError && error.exitCode === 1);
  assert.equal(calls, 0);
});

for (const flag of [undefined, false]) test(`fetch retains the unguarded legacy profile for runtime flag ${String(flag)}`, async () => {
  let calls = 0;
  const transport = createFetchTransport({ fetch: async input => {
    calls++;
    assert.ok(input instanceof Request);
    assert.equal(await input.text(), "upload");
    return new Response(null, { status: 204 });
  } });
  const input = {
    url: "https://allowed.test/upload", method: "POST", headers: [], signal: new AbortController().signal,
    body: toByteSource("upload"), ...(flag === undefined ? {} : { denyPrivateNetworks: flag }),
  };
  const response = await Reflect.apply(transport, undefined, [input]) as HttpResponse;
  assert.equal(response.status, 204);
  assert.equal(calls, 1);
  assert.equal(Reflect.get(transport, "supportsPrivateNetworkDeny"), undefined);
  await response.dispose();
});
