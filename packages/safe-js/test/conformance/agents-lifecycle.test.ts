import { expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({ workers: [] as Array<EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>;
}> }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => { this.emit("exit", 1); return 1; });
    constructor() { super(); state.workers.push(this); }
  } };
});
import { Test262Agents } from "./agents.js";

beforeEach(() => { state.workers.length = 0; });

it("waits for each independent broadcast acknowledgement", async () => {
  const fail = vi.fn();
  const agents = new Test262Agents({}, fail);
  const first = agents.start("first");
  const second = agents.start("second");
  state.workers.forEach(worker => worker.emit("message", { type: "ready" }));
  await Promise.all([first, second]);
  let completed = false;
  const sent = agents.broadcast(new SharedArrayBuffer(4), 0).then(() => { completed = true; });
  const id = state.workers[0].postMessage.mock.calls[0][0].messageId;
  state.workers[1].emit("message", { type: "received", id });
  await Promise.resolve();
  expect(completed).toBe(false);
  state.workers[0].emit("message", { type: "received", id });
  await sent;
  expect(completed).toBe(true);
  await agents.dispose();
  expect(fail).not.toHaveBeenCalled();
  expect(state.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
});

it("rejects a start cancelled before readiness and terminates its worker", async () => {
  const agents = new Test262Agents({}, vi.fn());
  const start = agents.start("pending");
  const rejected = expect(start).rejects.toThrow("disposed");
  await agents.dispose();
  await rejected;
  expect(state.workers[0].terminate).toHaveBeenCalledTimes(1);
  await expect(agents.start("late")).rejects.toThrow("disposed");
});

it("rejects outstanding broadcasts on exit and reports the host failure", async () => {
  const fail = vi.fn();
  const agents = new Test262Agents({}, fail);
  const start = agents.start("pending");
  state.workers[0].emit("message", { type: "ready" });
  await start;
  const broadcast = agents.broadcast(new SharedArrayBuffer(4), 3n);
  const rejected = expect(broadcast).rejects.toThrow("exited unexpectedly");
  state.workers[0].emit("exit", 2);
  await rejected;
  expect(fail).toHaveBeenCalledTimes(1);
  expect(() => agents.getReport()).toThrow("exited unexpectedly");
  await agents.dispose();
});

it("joins concurrent disposal without terminating a worker twice", async () => {
  const agents = new Test262Agents({}, vi.fn());
  const start = agents.start("pending");
  state.workers[0].emit("message", { type: "ready" });
  await start;
  const terminations: Array<(code: number) => void> = [];
  state.workers[0].terminate.mockImplementation(() => new Promise<number>(resolve => { terminations.push(resolve); }));
  const first = agents.dispose();
  const second = agents.dispose();
  try {
    expect(state.workers[0].terminate).toHaveBeenCalledTimes(1);
  } finally {
    for (const terminate of terminations) terminate(1);
    await Promise.all([first, second]);
  }
  await agents.dispose();
  expect(state.workers[0].terminate).toHaveBeenCalledTimes(1);
});

it.each([false, true])("waits for every termination before reporting a cleanup failure (synchronous=%s)", async synchronous => {
  const fail = vi.fn();
  const agents = new Test262Agents({}, fail);
  const starts = [agents.start("first"), agents.start("second")];
  state.workers.forEach(worker => worker.emit("message", { type: "ready" }));
  await Promise.all(starts);
  const failure = new Error("termination failed");
  if (synchronous) state.workers[0].terminate.mockImplementation(() => { throw failure; });
  else state.workers[0].terminate.mockRejectedValue(failure);
  let terminated!: (code: number) => void;
  state.workers[1].terminate.mockImplementation(() => new Promise<number>(resolve => { terminated = resolve; }));
  let settled = false;
  const disposal = agents.dispose().finally(() => { settled = true; });
  const rejected = expect(disposal).rejects.toThrow("termination failed");
  const joined = expect(agents.dispose()).rejects.toBe(failure);
  try {
    // This barrier drains promise reactions without waiting on a wall-clock delay.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally {
    terminated(1);
    await Promise.all([rejected, joined]);
  }
  await expect(agents.dispose()).rejects.toBe(failure);
  expect(state.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  expect(fail).not.toHaveBeenCalled();
});
