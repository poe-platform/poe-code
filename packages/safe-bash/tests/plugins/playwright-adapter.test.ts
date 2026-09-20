import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createPlaywrightAdapter } from "../../src/playwright/adapter.js";
import type { PlaywrightBrowser, PlaywrightContext } from "../../src/playwright/adapter.js";

function fixture() {
  const events = new EventEmitter();
  const contextEvents = new EventEmitter();
  const calls: string[] = [];
  let connected = true;
  const context = Object.assign(contextEvents, {
    newPage: async () => { throw new Error("unused"); },
    pages: () => [],
    close: async () => { calls.push("context.close"); contextEvents.emit("close"); },
  }) satisfies PlaywrightContext;
  const browser = Object.assign(events, {
    isConnected: () => connected,
    newContext: async () => { calls.push("newContext"); return context; },
  }) satisfies PlaywrightBrowser;
  const adapter = createPlaywrightAdapter({ chromium: {
    headed: false,
    acquireBrowser: async () => {
      calls.push("acquire");
      return { browser, release: async () => { calls.push("resource.release"); } };
    },
  } });
  return { adapter, browser, context, calls, disconnect() { connected = false; events.emit("disconnected"); } };
}

const request = () => ({ acquisitionId: "a1", session: "default", browser: "chromium" as const, headless: true, signal: new AbortController().signal });

test("unsupported engines and headed mode fail before host acquisition", async () => {
  const f = fixture();
  await assert.rejects(f.adapter.acquire({ ...request(), browser: "firefox" }), /Unsupported browser/);
  await assert.rejects(f.adapter.acquire({ ...request(), headless: false }), /Headed/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.adapter.browsers.chromium?.headed, false);
});

test("release shares completion and closes the isolated context before its host resource", async () => {
  const f = fixture();
  const lease = await f.adapter.acquire(request());
  let notifications = 0;
  lease.onClosed(() => { notifications++; });
  const first = lease.release();
  assert.equal(first, lease.release());
  await first;
  assert.deepEqual(f.calls, ["acquire", "newContext", "context.close", "resource.release"]);
  assert.equal(notifications, 1);
  lease.onClosed(() => { notifications++; });
  assert.equal(notifications, 2);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  assert.equal(f.context.listenerCount("close"), 0);
});

test("context closure and disconnection notify once; unsubscribe prevents notification", async () => {
  const f = fixture();
  const lease = await f.adapter.acquire(request());
  let notifications = 0;
  const unsubscribe = lease.onClosed(() => { notifications++; });
  unsubscribe();
  lease.onClosed(() => { notifications += 10; });
  f.disconnect();
  f.context.emit("close");
  assert.equal(notifications, 10);
  await lease.release();
  assert.equal(notifications, 10);
});

test("failed context acquisition retires the returned host resource", async () => {
  const f = fixture();
  f.browser.newContext = async () => { throw new Error("context failure"); };
  await assert.rejects(f.adapter.acquire(request()), /context failure/);
  assert.deepEqual(f.calls, ["acquire", "resource.release"]);
});

test("cancellation during opaque acquisition waits for completion and releases the late resource", async () => {
  const f = fixture();
  const controller = new AbortController();
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  f.browser.newContext = async () => { await pending; return f.context; };
  const acquisition = f.adapter.acquire({ ...request(), signal: controller.signal });
  await Promise.resolve();
  const reason = new Error("cancelled");
  controller.abort(reason);
  resolve();
  await assert.rejects(acquisition, error => error === reason);
  assert.deepEqual(f.calls, ["acquire", "context.close", "resource.release"]);
});

test("cleanup attempts host release even when context close fails and retains both errors", async () => {
  const f = fixture();
  const contextError = new Error("context close failed");
  const resourceError = new Error("resource release failed");
  f.context.close = async () => { throw contextError; };
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({ browser: f.browser, release: async () => { throw resourceError; } }),
  } });
  const lease = await adapter.acquire(request());
  const completion = lease.release();
  await assert.rejects(completion, error => error instanceof AggregateError && error.errors[0] === contextError && error.errors[1] === resourceError);
  assert.equal(lease.release(), completion);
  await assert.rejects(lease.release());
  // Local lease retirement is not proof of successful remote cleanup.
  let closed = false;
  lease.onClosed(() => { closed = true; });
  assert.equal(closed, true);
  assert.equal(f.context.listenerCount("close"), 0);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  f.disconnect();
  assert.equal(closed, true);
});

test("acquisition failure and cleanup failure are both preserved", async () => {
  const f = fixture();
  const cause = new Error("new context failed");
  const cleanup = new Error("release failed");
  f.browser.newContext = async () => { throw cause; };
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({ browser: f.browser, release: async () => { throw cleanup; } }),
  } });
  await assert.rejects(adapter.acquire(request()), error => error instanceof AggregateError && error.errors[0] === cause && error.errors[1] === cleanup);
});

test("already disconnected resources are rejected and retired without creating a context", async () => {
  const f = fixture();
  f.disconnect();
  await assert.rejects(f.adapter.acquire(request()), /closed/);
  assert.deepEqual(f.calls, ["acquire", "resource.release"]);
});

test("disconnect during context acquisition closes the late context and removes both listeners", async () => {
  const f = fixture();
  let complete!: (context: typeof f.context) => void;
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  f.browser.newContext = () => {
    started();
    return new Promise(resolve => { complete = resolve; });
  };
  const acquisition = f.adapter.acquire(request());
  await admitted;
  f.disconnect();
  complete(f.context);
  await assert.rejects(acquisition, /closed during context acquisition/);
  assert.deepEqual(f.calls, ["acquire", "context.close", "resource.release"]);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  assert.equal(f.context.listenerCount("close"), 0);
});

test("cancellation before host acquisition settles retires the browser without creating a context", async () => {
  const f = fixture();
  const controller = new AbortController();
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => {
      await pending;
      return { browser: f.browser, release: async () => { f.calls.push("resource.release"); } };
    },
  } });
  const acquisition = adapter.acquire({ ...request(), signal: controller.signal });
  const reason = new Error("cancelled before browser returned");
  controller.abort(reason);
  complete();
  await assert.rejects(acquisition, error => error === reason);
  assert.deepEqual(f.calls, ["resource.release"]);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
});

test("source acquisition failures retain reason identity and do not acquire a context", async () => {
  const f = fixture();
  const reason = new Error("trusted source partial-acquisition failure");
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => { throw reason; },
  } });
  await assert.rejects(adapter.acquire(request()), error => error === reason);
  assert.deepEqual(f.calls, []);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
});

test("successful close completion notifies even when the host emits no close event", async () => {
  const f = fixture();
  f.context.close = async () => { f.calls.push("context.close"); };
  const lease = await f.adapter.acquire(request());
  let notifications = 0;
  lease.onClosed(() => { notifications++; });
  await lease.release();
  assert.equal(notifications, 1);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  assert.equal(f.context.listenerCount("close"), 0);
});

test("an already cancelled request never allocates a browser", async () => {
  const f = fixture();
  const controller = new AbortController();
  const reason = new Error("cancelled before acquisition");
  controller.abort(reason);
  await assert.rejects(f.adapter.acquire({ ...request(), signal: controller.signal }), error => error === reason);
  assert.deepEqual(f.calls, []);
});

test("configured engines preserve source identity and headed support", async () => {
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    const f = fixture();
    const options = { ...request(), browser: engine, headless: false };
    const source = {
      headed: true,
      async acquireBrowser(received: typeof options) {
        assert.equal(this, source);
        assert.equal(received, options);
        return { browser: f.browser, release: async () => { f.calls.push("resource.release"); } };
      },
    };
    const adapter = createPlaywrightAdapter({ [engine]: source });
    assert.equal(adapter.browsers[engine]?.headed, true);
    const lease = await adapter.acquire(options);
    await lease.release();
    assert.deepEqual(f.calls, ["newContext", "context.close", "resource.release"]);
  }
});

test("later source-map changes do not change the captured capabilities or callback", async () => {
  const f = fixture();
  const sources = { chromium: {
    headed: false,
    acquireBrowser: async () => ({ browser: f.browser, release: async () => {} }),
  } };
  const adapter = createPlaywrightAdapter(sources);
  sources.chromium.headed = true;
  sources.chromium.acquireBrowser = async () => { throw new Error("replacement callback"); };
  await assert.rejects(adapter.acquire({ ...request(), headless: false }), /Headed/);
  const lease = await adapter.acquire(request());
  await lease.release();
  assert.equal(Object.isFrozen(adapter.browsers), true);
  assert.equal(Object.isFrozen(adapter.browsers.chromium), true);
});

test("closing one isolated lease leaves a sibling lease on the borrowed browser usable", async () => {
  const f = fixture();
  const sibling = fixture();
  let next = 0;
  let releases = 0;
  f.browser.newContext = async () => next++ === 0 ? f.context : sibling.context;
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({ browser: f.browser, release: async () => { releases++; } }),
  } });
  const first = await adapter.acquire(request());
  const second = await adapter.acquire({ ...request(), acquisitionId: "a2", session: "other" });
  let siblingClosed = false;
  second.onClosed(() => { siblingClosed = true; });
  await first.release();
  assert.equal(first.context, f.context);
  assert.equal(second.context, sibling.context);
  assert.equal(siblingClosed, false);
  assert.equal(f.browser.isConnected(), true);
  assert.equal(f.browser.listenerCount("disconnected"), 1);
  assert.equal(releases, 1);
  f.disconnect();
  assert.equal(siblingClosed, true);
  await second.release();
  assert.equal(releases, 2);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
});

test("release drains context closure and host release, including reentrant callers", async () => {
  const f = fixture();
  let finishContext!: () => void;
  let finishResource!: () => void;
  let contextStarted!: () => void;
  let resourceStarted!: () => void;
  const contextAdmission = new Promise<void>(resolve => { contextStarted = resolve; });
  const resourceAdmission = new Promise<void>(resolve => { resourceStarted = resolve; });
  f.context.close = () => {
    f.calls.push("context.close");
    contextStarted();
    return new Promise(resolve => { finishContext = resolve; });
  };
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({ browser: f.browser, release: () => {
      f.calls.push("resource.release");
      resourceStarted();
      return new Promise<void>(resolve => { finishResource = resolve; });
    } }),
  } });
  const lease = await adapter.acquire(request());
  let reentrant: Promise<void> | undefined;
  lease.onClosed(() => { reentrant = lease.release(); });
  const completion = lease.release();
  let settled = false;
  void completion.then(() => { settled = true; });
  await contextAdmission;
  assert.equal(settled, false);
  assert.deepEqual(f.calls, ["newContext", "context.close"]);
  finishContext();
  await resourceAdmission;
  assert.equal(reentrant, completion);
  assert.equal(settled, false);
  finishResource();
  await completion;
  assert.equal(settled, true);
});

test("a single close failure preserves identity while retiring local closure listeners", async () => {
  const f = fixture();
  const reason = new Error("context close rejected");
  f.context.close = async () => { throw reason; };
  const lease = await f.adapter.acquire(request());
  let notifications = 0;
  lease.onClosed(() => { notifications++; });
  await assert.rejects(lease.release(), error => error === reason);
  assert.deepEqual(f.calls, ["acquire", "newContext", "resource.release"]);
  assert.equal(notifications, 1);
  assert.equal(f.context.listenerCount("close"), 0);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  f.context.emit("close");
  f.disconnect();
  assert.equal(notifications, 1);
  assert.equal(f.context.listenerCount("close"), 0);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
});

test("host-release failure does not erase confirmed context closure", async () => {
  const f = fixture();
  const reason = new Error("host release rejected");
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({ browser: f.browser, release: async () => { throw reason; } }),
  } });
  const lease = await adapter.acquire(request());
  let notifications = 0;
  lease.onClosed(() => { notifications++; });
  const completion = lease.release();
  await assert.rejects(completion, error => error === reason);
  assert.equal(lease.release(), completion);
  assert.equal(notifications, 1);
  assert.equal(f.context.listenerCount("close"), 0);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
});

test("context closure observed during acquisition rejects and retires both resources", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.context.on = function (event, listener) {
    EventEmitter.prototype.on.call(this, event, listener);
    this.emit("close");
    return this;
  };
  await assert.rejects(f.adapter.acquire({ ...request(), signal: controller.signal }), /closed during context acquisition/);
  assert.deepEqual(f.calls, ["acquire", "newContext", "context.close", "resource.release"]);
  assert.equal(f.browser.listenerCount("disconnected"), 0);
  assert.equal(f.context.listenerCount("close"), 0);
});

test("command cancellation after publication does not close a transferred lease", async () => {
  const f = fixture();
  const controller = new AbortController();
  const lease = await f.adapter.acquire({ ...request(), signal: controller.signal });
  let closed = false;
  lease.onClosed(() => { closed = true; });
  controller.abort(new Error("command finished"));
  assert.equal(closed, false);
  assert.deepEqual(f.calls, ["acquire", "newContext"]);
  await lease.release();
  assert.equal(closed, true);
});
