import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { fetchMcpResponse } from "../dist/http.js";
test("host fetch cancellation settles independently and retires late response bodies", async () => {
  const controller = new AbortController(), reason = { cancelled: true };
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const operation = fetchMcpResponse(() => pending, "https://example.test", { signal: controller.signal }).catch(error => error);
  controller.abort(reason);
  assert.equal(await Promise.race([operation, new Promise(done => setImmediate(() => done("pending")))]), reason);
  let cancellations = 0;
  resolve(new Response(new ReadableStream({ cancel() { cancellations++; } })));
  await new Promise(done => setImmediate(done));
  assert.equal(cancellations, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("pre-cancelled fetch never invokes the host", async () => {
  const controller = new AbortController(), reason = {};
  controller.abort(reason);
  let calls = 0;
  await assert.rejects(fetchMcpResponse(async () => { calls++; return new Response(); }, "https://example.test", { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});
