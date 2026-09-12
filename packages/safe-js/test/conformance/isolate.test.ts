import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTest262Executor } from "./isolate.js";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));
class FakeWorker extends EventEmitter {
  stderr = new EventEmitter();
  stdout = { resume: vi.fn() };
  send = vi.fn();
  kill = vi.fn(() => { this.emit("exit", null, "SIGKILL"); return true; });
}
let children: FakeWorker[];
beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  vi.mocked(fork).mockImplementation(() => {
    const child = new FakeWorker(); children.push(child);
    queueMicrotask(() => child.emit("message", { type: "ready" }));
    return child as never;
  });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const input = { filename: "test.js", source: "0", mode: "strict" as const, harness: new Map<string, string>() };
async function dispatch() { await vi.advanceTimersByTimeAsync(0); }
it("reuses a ready worker and sends exactly the requested source, mode and unchanged budgets", async () => {
  const executor = createTest262Executor({ timeoutMs: 3000, budget: { maxSteps: 100 } });
  for (let i = 0; i < 2; i++) {
    const pending = executor.execute(input); await dispatch();
    const request = children[0].send.mock.calls[i][0];
    expect(request).toMatchObject({ type: "execute", ...input, harness: [], timeoutMs: 3000, budget: { maxSteps: 100 } });
    children[0].emit("message", { type: "started", id: request.id });
    children[0].emit("message", { type: "result", id: request.id, result: { mode: "strict", status: "passed" } });
    expect(await pending).toEqual({ mode: "strict", status: "passed" });
  }
  expect(children).toHaveLength(1); await executor.dispose();
  expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
});
it("kills a synchronously hung variant at the original wall timeout even without a started acknowledgement", async () => {
  const executor = createTest262Executor({ timeoutMs: 3000 });
  const pending = executor.execute(input); await dispatch();
  await vi.advanceTimersByTimeAsync(2999); expect(children[0].kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ mode: "strict", status: "failed", reason: "timeout" });
  expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
  const next = executor.execute({ ...input, mode: "sloppy" }); await dispatch();
  expect(children).toHaveLength(2);
  const request = children[1].send.mock.calls[0][0];
  children[1].emit("message", { type: "started", id: request.id });
  children[1].emit("message", { type: "result", id: request.id, result: { mode: "sloppy", status: "passed" } });
  expect(await next).toMatchObject({ mode: "sloppy", status: "passed" }); await executor.dispose();
});
it.each(["exit", "wrong-mode", "wrong-id", "error"])("never reports a pass after worker failure: %s", async failure => {
  const executor = createTest262Executor({ timeoutMs: 3000 });
  const pending = executor.execute(input); await dispatch();
  const request = children[0].send.mock.calls[0][0];
  if (failure === "exit") children[0].emit("exit", 1, null);
  else if (failure === "error") children[0].emit("error", new Error("worker died"));
  else children[0].emit("message", { type: "result", id: failure === "wrong-id" ? "stale" : request.id,
    result: { mode: failure === "wrong-mode" ? "sloppy" : "strict", status: "passed" } });
  expect(await pending).toMatchObject({ mode: "strict", status: "failed", reason: "host-error" }); await executor.dispose();
});
it("bounds startup separately without silently consuming or extending a variant timeout", async () => {
  vi.mocked(fork).mockImplementation(() => { const child = new FakeWorker();children.push(child);return child as never; });
  const executor = createTest262Executor({ timeoutMs: 3000 });
  const pending = executor.execute(input);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toMatchObject({ status: "failed", reason: "host-error", detail: { code: "worker-startup-timeout" } });
  expect(children[0].send).not.toHaveBeenCalled(); await executor.dispose();
});
it.each([0, -1, NaN, Infinity])("rejects an invalid hard wall timeout: %s", timeoutMs => {
  expect(() => createTest262Executor({ timeoutMs })).toThrow();
  expect(fork).not.toHaveBeenCalled();
});
it("requires exactly one started acknowledgement before accepting a result", async () => {
  const executor = createTest262Executor({ timeoutMs: 3000 });
  const pending = executor.execute(input); await dispatch();
  const request = children[0].send.mock.calls[0][0];
  children[0].emit("message", { type: "result", id: request.id, result: { mode: "strict", status: "passed" } });
  expect(await pending).toMatchObject({ status: "failed", reason: "host-error" }); await executor.dispose();
});
