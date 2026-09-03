import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, toByteSource } from "../../../src/contracts/index.js";
import { createFetchTransport } from "../../../src/commands/network/index.js";
import { createFetchTransport as createBrowserFetchTransport, cloudflareWorkerLimits } from "../../../src/browser.js";

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
