import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundedRegexProvider } from "./execution/bounded-provider.js";
import { RegexExecutor } from "./execution/portable.js";
import type { RegexWorkerRequest } from "./execution/provider.js";
import { defaults, trustedInputRows, trustedWorkerRequests, type Reply } from "./execution/protocol.js";

test("trusted synchronous replies remain owned across requests and workers", async context => {
  const workers = [createBoundedRegexProvider().createWorker(defaults), createBoundedRegexProvider().createWorker(defaults)];
  context.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  await Promise.resolve();
  const replies: Reply[] = [];
  for (const worker of workers) worker.on("message", value => { replies.push(value as Reply); });
  for (let index = 0; index < 3; index++) {
    const rows = [{ bytes: new TextEncoder().encode(index === 0 ? "private-a" : "private-b"), all: false, terminated: true }];
    trustedInputRows.add(rows);
    const request = { id: index + 1, descriptor: { kind: "rg" as const, patterns: ["private-a"], fixed: true, case: "sensitive" as const, whole: false, word: false, nullData: false }, rows };
    trustedWorkerRequests.add(request);
    workers[index % 2]!.postMessage(request);
  }
  assert.equal(replies.length, 3);
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3]);
  assert.equal(new Set(replies).size, 3);
  assert.deepEqual((replies[0] as { directMatches: unknown }).directMatches, [[{ start: 0, end: 9 }]]);
  assert.deepEqual((replies[1] as { directMatches: unknown }).directMatches, [[]]);
});

test("executor sends request-owned input envelopes on the trusted fast path", async context => {
  const provider = createBoundedRegexProvider();
  const executor = new RegexExecutor(provider);
  context.after(() => executor.dispose());
  const session = executor.open(new AbortController().signal);
  context.after(() => session.close());
  const requests: RegexWorkerRequest[] = [];
  const worker = provider.createWorker(defaults);
  // Preserve the provider's private in-process identity while intercepting its worker.
  const prototype = Object.getPrototypeOf(worker) as { postMessage: typeof worker.postMessage };
  const original = prototype.postMessage;
  context.mock.method(prototype, "postMessage", function (this: typeof worker, request: RegexWorkerRequest) {
    requests.push(request);
    original.call(this, request);
  });
  await worker.terminate();
  for (const text of ["warmup", "tenant-a", "tenant-b"]) {
    const rows = [{ bytes: new TextEncoder().encode(text), all: false, terminated: true }];
    trustedInputRows.add(rows);
    const result = await session.runSync({ kind: "rg", patterns: [text], fixed: true, case: "sensitive", whole: false, word: false, nullData: false }, rows);
    assert.deepEqual(result, [[{ start: 0, end: text.length }]]);
  }
  assert.equal(new Set(requests).size, 3);
  assert.deepEqual(requests.map(request => new TextDecoder().decode(request.rows[0]!.bytes)), ["warmup", "tenant-a", "tenant-b"]);
});
