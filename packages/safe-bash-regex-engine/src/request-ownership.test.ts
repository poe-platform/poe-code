import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundedRegexProvider } from "./execution/bounded-provider.js";
import { RegexExecutor } from "./execution/portable.js";
import type { RegexWorkerRequest } from "./execution/provider.js";
import { defaults, exprMatchCeilings, trustedInputRows, trustedWorkerRequests, type Reply } from "./execution/protocol.js";

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

for (const kind of ["expr-match", "bre-search"] as const) {
 for (const checkpoint of [false, true]) {
 for (const mutate of ["pattern", "subject"] as const) {
  test(`${kind} owns ${mutate} during async fallback, checkpoint=${checkpoint}`, async context => {
   if (checkpoint) {
    const OriginalController = AbortController;
    context.mock.method(globalThis, "AbortController", class extends OriginalController {
     constructor() { super(); registerYieldCheckpoint(this.signal, () => {}); }
    });
   }
   const worker = createBoundedRegexProvider().createWorker(defaults);
   context.after(() => worker.terminate());
   await Promise.resolve();
   const pattern = new TextEncoder().encode("a*b");
   const subject = new TextEncoder().encode("a".repeat(2000) + "b");
   const request = { id: 1, descriptor: { kind, pattern, profile: "byte" as const, limits: exprMatchCeilings }, rows: [{ bytes: subject, all: false, terminated: false }] };
   trustedWorkerRequests.add(request);
   let received = false;
   const reply = new Promise<unknown>(resolve => worker.on("message", value => { received = true; resolve(value); }));
   worker.postMessage(request);
   assert.equal(received, false, "must exercise asynchronous fallback");
   (mutate === "pattern" ? pattern : subject).fill(120);
   const result = await reply as { result: { matched: boolean; overall: unknown } };
   assert.equal(result.result.matched, true);
   assert.deepEqual(result.result.overall, { start: 0, end: 2001 });
  });
 }
}
}

test("speculative UTF-8 validation reports one worker error without an unhandled rejection", async context => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  context.after(() => executor.dispose());
  const session = executor.open(new AbortController().signal);
  context.after(() => session.close());
  const descriptor = { kind: "rg" as const, patterns: ["x"], fixed: true, case: "sensitive" as const, whole: false, word: false, nullData: false };
  const warmup = [{ bytes: Uint8Array.of(120), all: false, terminated: true }];
  trustedInputRows.add(warmup);
  await session.runSync(descriptor, warmup);
  const invalid = [{ bytes: Uint8Array.of(255), all: false, terminated: true }];
  trustedInputRows.add(invalid);
  await assert.rejects(async () => session.runSync(descriptor, invalid), /UTF-8/);
  // Let abandoned speculative promises surface in the test runner.
  await new Promise<void>(resolve => setImmediate(resolve));
});
