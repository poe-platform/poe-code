import { beforeEach, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { withRunResources } from "./resources.js";
import { waitForAtomicValue } from "./atomic-wait.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "./host-bridge.js";

const state = vi.hoisted(() => ({
  created: [] as Array<{ emit: (event: string, ...args: unknown[]) => boolean; terminate: ReturnType<typeof vi.fn>; posts: Array<{ id: number }> }>,
  startupError: undefined as Error | undefined,
  postError: undefined as Error | undefined,
  onPost: undefined as (() => void) | undefined
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    posts: Array<{ id: number }> = [];
    terminate = vi.fn(async () => { this.emit("exit", 1); return 1; });
    constructor() {
      super();
      if (state.startupError !== undefined) throw state.startupError;
      state.created.push(this);
    }
    postMessage(message: { id: number }) {
      if (state.postError !== undefined) throw state.postError;
      this.posts.push(message);
      state.onPost?.();
    }
  } };
});

beforeEach(() => {
  state.created.length = 0;
  state.startupError = undefined;
  state.postError = undefined;
  state.onPost = undefined;
});

it("retains the worker registration time rather than acknowledgement time", async () => {
  await withRunResources(undefined, async () => {
    const waiting = waitForAtomicValue(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000, new Budget());
    const worker = state.created[0];
    worker.emit("message", { id: worker.posts[0].id, kind: "registered", async: true,
      startedAt: performance.timeOrigin + 42 });
    expect(await waiting).toMatchObject({ async: true, startedAt: 42 });
  });
});

it("reuses one worker and acknowledges registration before settlement", async () => {
  const budget = new Budget();
  const view = new Int32Array(new SharedArrayBuffer(4));
  await withRunResources(undefined, async () => {
    const first = waitForAtomicValue(view, 0, 0, Infinity, budget);
    const second = waitForAtomicValue(view, 0, 0, Infinity, budget);
    expect(state.created).toHaveLength(1);
    const worker = state.created[0];
    for (const { id } of worker.posts) worker.emit("message", { id, kind: "registered", async: true });
    const results = await Promise.all([first, second]);
    expect(results.every(result => result.async)).toBe(true);
    expect([...budget.retainedValues()]).toContain(view.buffer);
    for (const { id } of worker.posts) worker.emit("message", { id, kind: "settled", value: "ok" });
    expect(await Promise.all(results.map(result => result.value))).toEqual(["ok", "ok"]);
  });
  expect(state.created[0].terminate).toHaveBeenCalledTimes(1);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each(["startup", "post"])("releases resources after %s failure", async phase => {
  const failure = new Error("worker unavailable");
  if (phase === "startup") state.startupError = failure;
  else state.postError = failure;
  const budget = new Budget();
  await expect(withRunResources(undefined, () =>
    waitForAtomicValue(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Infinity, budget)
  )).rejects.toBe(failure);
  expect([...budget.retainedValues()]).toEqual([]);
  if (phase === "post") expect(state.created[0].terminate).toHaveBeenCalledTimes(1);
});

it("rejects registration and awaits cleanup when aborted before acknowledgement", async () => {
  const controller = new AbortController();
  const failure = new Error("stop registration");
  await withRunResources(controller.signal, async () => {
    const waiting = waitForAtomicValue(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Infinity, new Budget());
    controller.abort(failure);
    await expect(waiting).rejects.toBe(failure);
  });
  expect(state.created[0].terminate).toHaveBeenCalledTimes(1);
});

it("rejects an acknowledged wait when its worker exits", async () => {
  await withRunResources(undefined, async () => {
    const waiting = waitForAtomicValue(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Infinity, new Budget());
    const worker = state.created[0];
    worker.emit("message", { id: worker.posts[0].id, kind: "registered", async: true });
    const result = await waiting;
    worker.emit("exit", 2);
    await expect(result.value).rejects.toThrow("Atomic waiter worker exited (2).");
  });
});

it("delivers settlement accounting failures through the wait promise", async () => {
  const budget = new Budget();
  const failure = new SandboxError({ budget: "dataSize", current: 2, limit: 1 });
  await withRunResources(undefined, async () => {
    const waiting = waitForAtomicValue(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Infinity, budget);
    const worker = state.created[0];
    const id = worker.posts[0].id;
    worker.emit("message", { id, kind: "registered", async: true });
    const result = await waiting;
    const retain = budget.setRetainedDataUsage.bind(budget);
    const check = vi.spyOn(budget, "setRetainedDataUsage").mockImplementation((owner, usage) => {
      if (usage === 1) throw failure;
      retain(owner, usage);
    });
    try {
      expect(() => worker.emit("message", { id, kind: "settled", value: "ok" })).not.toThrow();
      await expect(result.value).rejects.toBe(failure);
    } finally { check.mockRestore(); }
  });
});

it("delivers a worker failure as a guest Error after wait registration", async () => {
  state.onPost = () => {
    const worker = state.created[0];
    worker.emit("message", { id: worker.posts[0].id, kind: "registered", async: true });
  };
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const pending = run(`const wait=Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0);
    ready();try{await wait.value}catch(error){return [error.name,error.message,error instanceof Error]}`, {
    signal: controller.signal, bindings: { ready: entered }
  });
  const outcome = pending.catch(error => error);
  try {
    await ready;
    state.created[0].emit("error", new Error("wait worker failed"));
    expect(await outcome).toMatchObject({ ok: true, returnValue: ["Error", "wait worker failed", true] });
  } finally {
    controller.abort();
    await outcome;
  }
  expect(state.created[0].terminate).toHaveBeenCalledTimes(1);
});

it("restores a pending atomic checkpoint with controlled worker registration", async () => {
  const controller = new AbortController();
  let posted!: () => void;
  let registration = new Promise<void>(resolve => { posted = resolve; });
  state.onPost = () => posted();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const views: Int32Array[] = [];
  const settlements: Promise<string>[] = [];
  function acknowledge(worker: (typeof state.created)[number]) {
    const message = worker.posts[0] as { id: number; buffer: SharedArrayBuffer; offset: number; expected: number; timeout: number };
    const view = new Int32Array(message.buffer, message.offset, 1);
    views.push(view);
    const wait = Reflect.apply(Reflect.get(Atomics, "waitAsync"), Atomics,
      [view, 0, message.expected, message.timeout]) as { async: boolean; value: Promise<string> };
    expect(wait.async).toBe(true);
    settlements.push(wait.value);
    worker.emit("message", { id: message.id, kind: "registered", async: true });
    void wait.value.then(value => worker.emit("message", { id: message.id, kind: "settled", value }));
  }
  const source = `const a=new Int32Array(new SharedArrayBuffer(4));
    const waiter=Atomics.waitAsync(a,0,0);await gate();
    return [Atomics.notify(a,0),await waiter.value]`;
  const pending = run(source, { signal: controller.signal,
    bindings: { gate: declareHostOperation(async () => { entered(); return gate; }, "re-issue") } });
  const outcome = pending.catch(error => error);
  let replayOutcome: Promise<unknown> | undefined;
  try {
    await registration;
    acknowledge(state.created[0]);
    await ready;
    await new Promise<void>(resolve => setImmediate(resolve));
    const snapshot = JSON.parse(await dump(pending, { mode: "replay" }));
    resume();
    expect(await outcome).toMatchObject({ ok: true, returnValue: [1, "ok"] });
    registration = new Promise<void>(resolve => { posted = resolve; });
    let replayGateCalls = 0;
    const replay = run(source, { snapshot, signal: controller.signal,
      bindings: { gate: declareHostOperation(async () => { replayGateCalls++; }, "re-issue") } });
    replayOutcome = replay.catch(error => error);
    await registration;
    expect(state.created).toHaveLength(2);
    expect(replayGateCalls).toBe(0);
    acknowledge(state.created[1]);
    expect(await replayOutcome).toMatchObject({ ok: true, returnValue: [1, "ok"] });
    expect(replayGateCalls).toBe(1);
    for (const worker of state.created) expect(worker.terminate).toHaveBeenCalledTimes(1);
    for (const view of views) expect(Atomics.notify(view, 0)).toBe(0);
  } finally {
    resume();
    controller.abort();
    for (const view of views) Atomics.notify(view, 0);
    await Promise.all([outcome, replayOutcome, ...settlements]);
  }
});
