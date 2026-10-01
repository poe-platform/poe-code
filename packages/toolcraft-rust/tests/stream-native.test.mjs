import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "toolcraft";
import { S } from "toolcraft-schema";
import { getEventListeners } from "node:events";

test("managed streams are exported and retain lazy iteration, statuses and cleanup", async () => {
  assert.equal(typeof native.createManagedStream, "function");
  async function run(api) {
    const log = [];
    const consumer = new AbortController();
    const stream = api.createManagedStream({
      eventSchema: S.String(), signal: consumer.signal,
      onStatus(event) { log.push(["status", event]); },
      async create(signal, status) {
        log.push(["create", signal === stream.signal]);
        status({ type: "connected" });
        return { [Symbol.asyncIterator]() {
          log.push("iterator");
          return {
            async next() { log.push("next"); return { done: false, value: "ready" }; },
            async return() { log.push("return"); }
          };
        } };
      }
    });
    assert.deepEqual(log, []);
    const iterator = stream[Symbol.asyncIterator]();
    log.push(await iterator.next());
    const reason = { reason: "stop" };
    const closing = stream.cancel(reason);
    assert.equal(stream.cancel(), closing);
    assert.equal(stream.signal.reason, reason);
    await closing;
    log.push(await iterator.next());
    assert.equal(getEventListeners(consumer.signal, "abort").length, 0);
    return log;
  }
  assert.deepEqual(await run(native), await run(reference));
});

test("cancellation during startup closes the late iterator without pulling", async () => {
  async function run(api) {
    const log = [];
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const stream = api.createManagedStream({ eventSchema: S.String(), create: () => pending });
    const next = stream[Symbol.asyncIterator]().next();
    const close = stream.cancel("cancelled");
    resolve({ [Symbol.asyncIterator]: () => ({
      next: () => { log.push("next"); return { done: false, value: "late" }; },
      return: () => { log.push("return"); }
    }) });
    await close;
    log.push(await next);
    return log;
  }
  assert.deepEqual(await run(native), await run(reference));
});

test("invalid events preserve cleanup and separate abort/rejection errors", async () => {
  async function run(api) {
    const events = [];
    const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 7 }),
        return: async () => { events.push("return"); }
      })
    }) });
    const error = await stream[Symbol.asyncIterator]().next().catch(error => error);
    assert.equal(error.name, "UserError");
    assert.notEqual(error, stream.signal.reason);
    assert.equal(error.message, stream.signal.reason.message);
    return { events, message: error.message, aborted: stream.signal.aborted };
  }
  assert.deepEqual(await run(native), await run(reference));
});

test("pull and cleanup failures retain arbitrary thrown values and error precedence", async () => {
  for (const failure of [undefined, null, 7, Symbol("failure"), { reason: "failure" }]) {
    for (const api of [native, reference]) {
      const cleanupFailure = { cleanup: failure };
      let returns = 0;
      const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => { throw failure; },
          return: () => { returns++; throw cleanupFailure; }
        })
      }) });
      await assert.rejects(stream[Symbol.asyncIterator]().next(), error => error === cleanupFailure);
      await assert.rejects(stream.cancel(), error => error === cleanupFailure);
      if (failure !== undefined) assert.equal(stream.signal.reason, failure);
      assert.equal(returns, 1);
    }
  }
});

test("consumer and result getters preserve read order and validation keeps original values", async () => {
  async function run(api) {
    const log = [];
    let reads = 0;
    const options = new Proxy({
      eventSchema: S.Object({ label: S.Optional(S.String({ default: "parsed" })) }),
      onStatus(event) { log.push(["status", this === options, event]); },
      async create() {
        log.push(["create", this === options]);
        return { [Symbol.asyncIterator]() {
          log.push("iterator");
          return { next() { return {
            get done() { log.push("done"); return false; },
            get value() { log.push("value"); return reads++ === 0 ? {} : { label: "original" }; }
          }; } };
        } };
      }
    }, { get(target, key, receiver) { log.push(["option", key]); return Reflect.get(target, key, receiver); } });
    const stream = api.createManagedStream(options);
    const value = await stream[Symbol.asyncIterator]().next();
    await stream.cancel();
    return { log, value };
  }
  assert.deepEqual(await run(native), await run(reference));
});

test("result getter exceptions leave cleanup ownership with the consumer", async () => {
  for (const api of [native, reference]) for (const key of ["done", "value"]) {
    const failure = { key };
    let returned = 0;
    const result = { done: false, value: "valid" };
    Object.defineProperty(result, key, { get() { throw failure; } });
    const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => result, return: () => { returned++; } })
    }) });
    await assert.rejects(stream[Symbol.asyncIterator]().next(), error => error === failure);
    assert.equal(stream.signal.aborted, false);
    assert.equal(returned, 0);
    await stream.cancel();
    assert.equal(returned, 1);
  }
});

test("native continuation steps preserve Promise microtask boundaries", async () => {
  async function run(api) {
    let tick = 0, running = true;
    const log = [];
    const count = () => { if (running) { tick++; queueMicrotask(count); } };
    queueMicrotask(count);
    try {
      const stream = api.createManagedStream({ eventSchema: S.String(), async create() {
        log.push(["create", tick]);
        return { [Symbol.asyncIterator]() {
          log.push(["iterator", tick]);
          return {
            async next() { log.push(["next", tick]); return { done: false, value: "event" }; },
            async return() { log.push(["return", tick]); }
          };
        } };
      } });
      await stream[Symbol.asyncIterator]().next();
      log.push(["received", tick]);
      await stream.cancel();
      log.push(["closed", tick]);
      return log;
    } finally { running = false; }
  }
  assert.deepEqual(await run(native), await run(reference));
});

test("reentrant abort cancellation shares the exact cleanup promise", async () => {
  for (const api of [native, reference]) {
    let returned = 0;
    const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: "ready" }), return: () => { returned++; } })
    }) });
    await stream[Symbol.asyncIterator]().next();
    let reentrant;
    stream.signal.addEventListener("abort", () => { reentrant = stream.cancel(); });
    const closing = stream.cancel();
    assert.equal(closing, reentrant);
    await closing;
    assert.equal(returned, 1);
  }
});

test("host signal truthiness matches reference branching", async () => {
  async function alteredSignal(api) {
    let created = 0;
    const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => {
      created++;
      return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: "value" }) }) };
    } });
    Object.defineProperty(stream.signal, "aborted", { value: 1 });
    const result = await stream[Symbol.asyncIterator]().next();
    await stream.cancel();
    return { created, result };
  }
  assert.deepEqual(await alteredSignal(native), await alteredSignal(reference));
});

test("undefined validation messages preserve raw events", async () => {
  async function alteredJoin(api) {
    const stream = api.createManagedStream({ eventSchema: S.String(), create: async () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: 7 }) })
    }) });
    const join = Array.prototype.join;
    try {
      Array.prototype.join = function(separator) { return separator === "; " ? undefined : join.call(this, separator); };
      return await stream[Symbol.asyncIterator]().next();
    } finally { Array.prototype.join = join; await stream.cancel(); }
  }
  assert.deepEqual(await alteredJoin(native), await alteredJoin(reference));
});

test("concurrent pulls can finish after natural completion without closing the iterator", async () => {
  for (const api of [native, reference]) {
    const consumer = new AbortController();
    const pending = [];
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    let returned = 0;
    const stream = api.createManagedStream({
      eventSchema: S.String(), signal: consumer.signal,
      create: async () => ({ [Symbol.asyncIterator]: () => ({
        next: () => new Promise(resolve => { pending.push(resolve); if (pending.length === 2) ready(); }),
        return: () => { returned++; }
      }) })
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    const second = iterator.next();
    await started;
    pending[0]({ done: true, value: "discarded" });
    assert.deepEqual(await first, { done: true, value: undefined });
    assert.equal(stream.signal.aborted, false);
    assert.equal(getEventListeners(consumer.signal, "abort").length, 0);
    pending[1]({ done: false, value: "in flight" });
    assert.deepEqual(await second, { done: false, value: "in flight" });
    await stream.cancel("after completion");
    assert.equal(stream.signal.reason, "after completion");
    assert.equal(returned, 0);
  }
});

test("listener removal failures retain synchronous close and done-state semantics", async () => {
  for (const api of [native, reference]) {
    const failure = { detach: true };
    let removals = 0, returned = 0;
    const signal = {
      aborted: false, addEventListener() {},
      removeEventListener() { if (++removals === 1) throw failure; }
    };
    const stream = api.createManagedStream({
      eventSchema: S.String(), signal,
      create: async () => ({ [Symbol.asyncIterator]: () => ({
        next: () => ({ done: false, value: "ready" }),
        return: () => { returned++; }
      }) })
    });
    await stream[Symbol.asyncIterator]().next();
    assert.throws(() => stream.cancel(), error => error === failure);
    assert.equal(stream.signal.aborted, false);
    await stream.cancel("retry");
    assert.equal(removals, 2);
    assert.equal(returned, 0);
    assert.equal(stream.signal.reason, "retry");
  }
});
