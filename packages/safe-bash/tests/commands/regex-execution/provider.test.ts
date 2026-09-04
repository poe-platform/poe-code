import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import type { Request } from "../../../src/commands/regex-execution/protocol.js";

class Transport extends EventEmitter {
  stopped = 0;
  messages: Request[] = [];
  finish: (() => void) | undefined;
  private notifyRequest!: () => void;
  private notifyRetirement!: () => void;
  readonly submitted = new Promise<void>(resolve => { this.notifyRequest = resolve; });
  readonly retiring = new Promise<void>(resolve => { this.notifyRetirement = resolve; });
  constructor(readonly holdClose = false, ready = true) {
    super();
    if (ready) queueMicrotask(() => this.emit("message", { ready: true }));
  }
  postMessage(request: Request): void { this.messages.push(request); this.notifyRequest(); }
  async terminate(): Promise<void> {
    this.stopped++;
    const closing = this.holdClose ? new Promise<void>(resolve => { this.finish = resolve; }) : Promise.resolve();
    this.notifyRetirement();
    await closing;
  }
}

const descriptor = { kind: "grep", patterns: ["x"], fixed: false, extended: true, insensitive: false, whole: false, word: false } as const;
const rows = [{ bytes: new Uint8Array([120]), all: true, terminated: true }];

test("injected transport deadline waits for retirement and close is idempotent", { timeout: 3000 }, async () => {
  const transport = new Transport(true);
  const executor = new RegexExecutor({ createWorker: () => transport }, { requestTimeoutMs: 5 });
  const session = executor.open(new AbortController().signal);
  let settled = false;
  const request = session.run(descriptor, rows).finally(() => { settled = true; });
  const rejected = assert.rejects(request, { code: "REQUEST_TIMEOUT" });
  await transport.retiring;
  assert.equal(settled, false);
  transport.finish!();
  await rejected;
  await Promise.all([session.close(), session.close(), executor.dispose()]);
  assert.equal(transport.stopped, 1);
  assert.equal(transport.eventNames().length, 0);
});

test("queued cancellation and admission budgets never dispatch cancelled work", { timeout: 3000 }, async () => {
  const transport = new Transport();
  const executor = new RegexExecutor({ createWorker: () => transport }, { maxWorkers: 1, maxQueuedRequests: 1, maxQueuedBytes: 512 });
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const first = session.run(descriptor, rows);
  const second = session.run(descriptor, rows);
  await assert.rejects(session.run(descriptor, rows), { code: "QUEUE_EXHAUSTED" });
  const reason = new Error("cancelled");
  const rejected = [assert.rejects(first, error => error === reason), assert.rejects(second, error => error === reason)];
  controller.abort(reason);
  await Promise.all(rejected);
  await session.close();
  assert.ok(transport.messages.length <= 1);
  assert.equal(transport.stopped, 1);
});

test("startup timeout and disposal retire injected resources", { timeout: 3000 }, async () => {
  const transport = new Transport(false, false);
  const executor = new RegexExecutor({ createWorker: () => transport }, { startupTimeoutMs: 5 });
  const session = executor.open(new AbortController().signal);
  await assert.rejects(session.run(descriptor, rows), { code: "STARTUP_TIMEOUT" });
  await executor.dispose();
  await session.close();
  assert.equal(transport.stopped, 1);
  assert.throws(() => executor.open(new AbortController().signal), { code: "CLOSED" });
});

test("injected reply ranges are bounded before materializing match objects", { timeout: 3000 }, async () => {
  const transport = new Transport();
  const executor = new RegexExecutor({ createWorker: () => transport });
  const session = executor.open(new AbortController().signal);
  const request = session.run(descriptor, rows);
  await transport.submitted;
  const rejected = assert.rejects(request, { code: "PROTOCOL" });
  transport.emit("message", { id: transport.messages[0]!.id, results: [new Float64Array(100)] });
  await rejected;
  await session.close();
});
