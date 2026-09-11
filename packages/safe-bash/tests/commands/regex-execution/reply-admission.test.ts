import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import test from "node:test";
import * as protocol from "../../../src/commands/regex-execution/protocol.js";
import type { Request, Row } from "../../../src/commands/regex-execution/protocol.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";

function fixture(count: number): { row: Row; ranges: Float64Array } {
  const ranges = new Float64Array(count * 2);
  for (let index = 0; index < count; index++) { ranges[index * 2] = index; ranges[index * 2 + 1] = index; }
  return { row: { bytes: new Uint8Array(Math.max(0, count - 1)), all: true, terminated: true }, ranges };
}

const signal = () => new AbortController().signal;
const tiny: Row = { bytes: Uint8Array.of(97), all: true, terminated: true };
const originalPush = Array.prototype.push;

test("regex reply range policy has fixed frozen per-row and per-reply limits", () => {
  assert.deepEqual(Reflect.get(protocol, "matchRangeLimits"), { perRow: 100_000, perReply: 100_000 });
  assert.equal(Object.isFrozen(Reflect.get(protocol, "matchRangeLimits")), true);
});

test("regex reply admission accepts zero, one and exactly 100000 raw ranges", () => {
  for (const count of [0, 1, 100_000]) {
    const { row, ranges } = fixture(count);
    const result = protocol.validateReply({ id: 1, results: [ranges] }, 1, [row], signal());
    assert.equal(result[0]!.length, count);
    if (count) assert.deepEqual(result[0]!.at(-1), { start: count - 1, end: count - 1 });
  }
});

test("regex reply admission rejects 100001 raw ranges in one otherwise-valid row", () => {
  const { row, ranges } = fixture(100_001);
  assert.throws(() => protocol.validateReply({ id: 1, results: [ranges] }, 1, [row], signal()), { code: "PROTOCOL" });
});

test("regex reply admission accepts exact aggregate capacity and rejects one extra raw range", () => {
  const first = fixture(50_000), second = fixture(50_001);
  const exact = protocol.validateReply({ id: 1, results: [first.ranges, first.ranges] }, 1, [first.row, first.row], signal());
  assert.deepEqual(exact.map(row => row.length), [50_000, 50_000]);
  assert.throws(() => protocol.validateReply({ id: 1, results: [first.ranges, second.ranges] }, 1, [first.row, second.row], signal()), { code: "PROTOCOL" });
});

for (const kind of ["vector type", "odd vector", "input-relative bound", "first-match restriction", "row capacity", "aggregate capacity"]) {
  test(`regex reply preflights later ${kind} before invoking any result map`, () => {
    const first = kind === "aggregate capacity" ? fixture(50_000) : fixture(1);
    const second = kind === "row capacity" ? fixture(100_001) : kind === "aggregate capacity" ? fixture(50_001) : { row: tiny, ranges: new Float64Array([0, 0]) };
    let later: unknown = second.ranges;
    let row = second.row;
    if (kind === "vector type") later = [0, 0];
    if (kind === "odd vector") later = new Float64Array(1);
    if (kind === "input-relative bound") later = new Float64Array(6);
    if (kind === "first-match restriction") { later = new Float64Array(4); row = { ...tiny, all: false }; }
    const results = [first.ranges, later];
    let mapped = 0;
    Object.defineProperty(results, "map", { value: (...args: Parameters<typeof results.map>) => {
      mapped++;
      return Array.prototype.map.apply(results, args);
    } });
    assert.throws(() => protocol.validateReply({ id: 1, results }, 1, [first.row, row], signal()), { code: "PROTOCOL" });
    assert.equal(mapped, 0);
    results.map(value => value);
    assert.equal(mapped, 1, "the observer must recognize an actual result map");
  });
}

test("regex reply admission retains range order, raw duplicates, input bounds and worker error conventions", () => {
  assert.deepEqual(protocol.validateReply({ id: 1, results: [new Float64Array([0, 0, 0, 0])] }, 1, [tiny], signal()), [[{ start: 0, end: 0 }, { start: 0, end: 0 }]]);
  for (const ranges of [[-1, 0], [0, 2], [1, 0], [0.5, 1], [1, 1, 0, 0]]) {
    assert.throws(() => protocol.validateReply({ id: 1, results: [new Float64Array(ranges)] }, 1, [tiny], signal()), { code: "PROTOCOL" });
  }
  assert.throws(() => protocol.validateReply({ id: 1, error: "matches per line limit exceeded" }, 1, [], signal()), { code: "MATCH", message: "matches per line limit exceeded" });
  assert.throws(() => protocol.validateReply({ id: 1, error: false }, 1, [], signal()), { code: "PROTOCOL" });
  assert.throws(() => protocol.validateReply({ id: 2, results: [] }, 1, [], signal()), { code: "PROTOCOL" });
});

for (const reason of [false, null, 0, ""]) {
  test(`regex reply admission preserves pre-aborted falsey identity: ${JSON.stringify(reason)}`, () => {
    const reply = { get id(): number { return assert.fail("aborted replies must not be inspected"); } };
    assert.throws(() => protocol.validateReply(reply, 1, [], AbortSignal.abort(reason)), error => Object.is(error, reason));
  });
}

test("regex reply range refusal retires supported injected transport resources", async () => {
  const { row, ranges } = fixture(100_001);
  class Transport extends EventEmitter {
    stopped = 0;
    constructor() { super(); queueMicrotask(() => this.emit("message", { ready: true })); }
    postMessage(request: Request): void { queueMicrotask(() => this.emit("message", { id: request.id, results: [ranges] })); }
    async terminate(): Promise<void> { this.stopped++; }
  }
  const transport = new Transport(), executor = new RegexExecutor({ createWorker: () => transport });
  const session = executor.open(signal());
  try {
    await assert.rejects(session.run({ kind: "grep", patterns: [""], fixed: false, extended: true, insensitive: false, whole: false, word: false }, [row]), { code: "PROTOCOL" });
  } finally { await session.close(); await executor.dispose(); }
  assert.equal(transport.stopped, 1);
  assert.equal(transport.eventNames().length, 0);
});

for (const growing of [false, true]) {
  test(`regex reply ${growing ? "rejects shared length drift during reconstruction" : "preserves stable shared vectors"}`, async context => {
    const synchronization = new Int32Array(new SharedArrayBuffer(4));
    let received = false;
    let checks = 0;
    let stopped = 0;
    let copied = 0;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      for (const item of items) {
        if (item && typeof item === "object" && Object.hasOwn(item, "start") && Object.hasOwn(item, "end")) copied++;
      }
      return originalPush.apply(this, items);
    };
    context.after(() => { Array.prototype.push = originalPush; });
    let worker!: Worker;
    const executor = new RegexExecutor({ createWorker(policy) {
      worker = new Worker(`
        const { parentPort, workerData } = require("node:worker_threads");
        let buffer;
        parentPort.on("message", message => {
          if (message.grow) {
            buffer.grow(1600016);
            Atomics.store(workerData.synchronization, 0, 1);
            Atomics.notify(workerData.synchronization, 0);
            return;
          }
          buffer = workerData.growing
            ? new SharedArrayBuffer(1600000, { maxByteLength: 1600016 })
            : new SharedArrayBuffer(1600000);
          parentPort.postMessage({ id: message.id, results: [new Float64Array(buffer)] });
        });
        parentPort.postMessage({ ready: true });
      `, { eval: true, execArgv: [], workerData: { synchronization, growing }, resourceLimits: {
        maxOldGenerationSizeMb: policy.workerOldGenerationMb, stackSizeMb: policy.workerStackMb,
      } });
      const listeners = new Map<unknown, (value: unknown) => void>();
      return {
        postMessage(request) { worker.postMessage(request); },
        on(event, listener) {
          const wrapped = (value: unknown) => {
            if (event === "message" && value && typeof value === "object" && "results" in value) received = true;
            (listener as (value: unknown) => void)(value);
          };
          listeners.set(listener, wrapped);
          worker.on(event, wrapped);
        },
        off(event, listener) {
          const wrapped = listeners.get(listener);
          if (wrapped) worker.off(event, wrapped);
          listeners.delete(listener);
        },
        async terminate() { stopped++; return worker.terminate(); },
        ref() { worker.ref(); }, unref() { worker.unref(); },
      };
    } });
    const session = executor.open(signal());
    if (growing) {
      // Scheduling instrumentation only: the real worker mutates a genuine
      // length-tracking shared view during copying, without reply accessors.
      const requestSignal = Reflect.get(session, "requestSignal") as AbortSignal;
      const previousCheck = Object.getOwnPropertyDescriptor(requestSignal, "throwIfAborted");
      const check = requestSignal.throwIfAborted.bind(requestSignal);
      requestSignal.throwIfAborted = () => {
        check();
        if (received && ++checks === 100) {
          worker.postMessage({ grow: true });
          assert.notEqual(Atomics.wait(synchronization, 0, 0, 2000), "timed-out", "worker growth must finish at the bounded copy barrier");
          assert.equal(Atomics.load(synchronization, 0), 1);
        }
      };
      context.after(() => {
        if (previousCheck) Object.defineProperty(requestSignal, "throwIfAborted", previousCheck);
        else Reflect.deleteProperty(requestSignal, "throwIfAborted");
      });
    }
    try {
      const request = session.run({ kind: "grep", patterns: [""], fixed: false, extended: true, insensitive: false, whole: false, word: false },
        [{ bytes: new Uint8Array(100_000), all: true, terminated: true }]);
      if (growing) await assert.rejects(request, { code: "PROTOCOL" });
      else assert.equal((await request)[0]!.length, 100_000);
    } finally { await session.close(); await executor.dispose(); }
    assert.equal(stopped, 1);
    assert.equal(worker.listenerCount("message"), 0);
    assert.equal(worker.listenerCount("error"), 0);
    assert.equal(copied, 100_000, "reconstruction must never exceed the admitted count even after growth");
    if (growing) assert.equal(Atomics.load(synchronization, 0), 1);
  });
}

test("regex shared-reply copy instrumentation restores the array method", () => {
  assert.equal(Array.prototype.push, originalPush);
});
