import { beforeEach, expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { withRunResources } from "./resources.js";
import { waitForAtomicValue } from "./atomic-wait.js";
import { run } from "../run.js";

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
