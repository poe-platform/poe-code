import assert from "node:assert/strict";
import test from "node:test";
import { createFetchTransport } from "./fetch-transport.js";
import { CurlError } from "./types.js";

const request = () => ({ url: "https://example.test/", method: "GET", headers: [], signal: new AbortController().signal });

test("Fetch advertises response-header deadlines without claiming connection-phase timing", () => {
  const transport = createFetchTransport();
  assert.equal(transport.supportsConnectTimeout, undefined);
  assert.equal(transport.supportsResponseHeaderTimeout, true);
});

test("Fetch header deadline aborts a stalled request and releases a late response", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fetchSignal: AbortSignal | undefined;
  let release!: (response: Response) => void;
  let started!: () => void;
  const invoked = new Promise<void>(resolve => { started = resolve; });
  const transport = createFetchTransport({ fetch: async input => {
    fetchSignal = (input as Request).signal;
    started();
    return new Promise<Response>(resolve => { release = resolve; });
  } });
  const pending = transport({ ...request(), responseHeaderTimeoutMs: 10 });
  const rejected = assert.rejects(pending, error => error instanceof CurlError && error.exitCode === 28);
  await invoked;
  t.mock.timers.tick(20);
  await rejected;
  assert.equal(fetchSignal?.aborted, true);
  let cancelled!: () => void;
  const retired = new Promise<void>(resolve => { cancelled = resolve; });
  release(new Response(new ReadableStream({ cancel() { cancelled(); } })));
  await retired;
});

test("Fetch clears its header deadline before streaming the response body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fetchSignal: AbortSignal | undefined;
  const transport = createFetchTransport({ fetch: async input => {
    fetchSignal = (input as Request).signal;
    return new Response("body");
  } });
  const response = await transport({ ...request(), responseHeaderTimeoutMs: 10 });
  t.mock.timers.tick(20);
  assert.equal(fetchSignal?.aborted, false);
  let text = "";
  for await (const bytes of response.body) text += new TextDecoder().decode(bytes);
  assert.equal(text, "body");
  await response.dispose();
});

test("Fetch preserves caller cancellation and does not ignore an exact connection deadline", async () => {
  const reason = new Error("caller stopped");
  const caller = new AbortController();
  let started!: () => void;
  const invoked = new Promise<void>(resolve => { started = resolve; });
  const transport = createFetchTransport({ fetch: async () => { started(); return new Promise<Response>(() => {}); } });
  const pending = transport({ ...request(), signal: caller.signal, responseHeaderTimeoutMs: 10_000 });
  const rejected = assert.rejects(pending, error => error === reason);
  await invoked;
  caller.abort(reason);
  await rejected;
  await assert.rejects(transport({ ...request(), connectTimeoutMs: 10 }), /connection timeout/);
});

for (const milliseconds of [undefined, 0, Infinity]) test(`Fetch header deadline ${milliseconds} remains disabled while waiting`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: (response: Response) => void;
  let started!: () => void;
  let signal: AbortSignal | undefined;
  const invoked = new Promise<void>(resolve => { started = resolve; });
  const transport = createFetchTransport({ fetch: async input => {
    signal = (input as Request).signal;
    started();
    return new Promise<Response>(resolve => { release = resolve; });
  } });
  const pending = transport({ ...request(), ...(milliseconds === undefined ? {} : { responseHeaderTimeoutMs: milliseconds }) });
  await invoked;
  t.mock.timers.tick(100_000);
  assert.equal(signal?.aborted, false);
  release(new Response("ok"));
  await (await pending).dispose();
});
