import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "./session.js";
import { createMemoryFileSystem } from "./engine/index.js";
import { executeInWorker } from "./execution.js";
import { browserWorkerRuntime } from "./engine/workers.mjs";
import type { ExecutionMessage } from "./execution-protocol.js";
import { browserWorkerFixture } from "../test/browser-worker.js";
import { setTimeout as delay } from "node:timers/promises";

vi.mock("virtual:safe-bash-worker-sources", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  return { sources: (await buildBrowserEngine({ workersOnly: true })).workerSources };
});

vi.mock("./engine/index.js", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  const built = await buildBrowserEngine();
  return import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function controlledWorkers() {
  const workers: ControlledWorker[] = [];
  class ControlledWorker extends EventTarget {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      super();
      workers.push(this);
    }
    emit(message: ExecutionMessage) {
      this.dispatchEvent(new MessageEvent("message", { data: message }));
    }
  }
  vi.stubGlobal("Worker", ControlledWorker);
  return workers;
}

describe("dedicated playground execution", () => {
  it("does not execute on the page when dedicated workers cannot start", async () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("Workers blocked by browser policy");
      }
    });
    const session = await createSession();
    const result = await session.run("echo must-not-run > /home/unexpected.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Workers blocked by browser policy");
    expect((await session.entries()).some((entry) => entry.path === "/home/unexpected.txt")).toBe(false);
  });

  it("terminates a worker that never acknowledges startup", async () => {
    const workers = controlledWorkers();
    vi.useFakeTimers();
    const result = executeInWorker(createMemoryFileSystem(), "echo blocked", "/", "help", vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ exitCode: 124 });
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it("retains acknowledged writes, ignores stale messages, and restarts after hard termination", async () => {
    const workers = controlledWorkers();
    const filesystem = createMemoryFileSystem();
    const state = vi.fn();
    vi.useFakeTimers();
    const running = executeInWorker(filesystem, "blocked work", "/", "help", state);
    const worker = workers[0]!;
    worker.emit({ kind: "ready" });
    worker.emit({ kind: "state", cwd: "/saved" });
    worker.emit({ kind: "fs", identity: 1, method: "writeFile", args: ["/kept", new Uint8Array([7])] });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: "fs-result", identity: 1, value: undefined });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await running).toMatchObject({ exitCode: 124 });
    expect(state).toHaveBeenLastCalledWith("/saved");
    expect(await filesystem.readFile("/kept")).toEqual(new Uint8Array([7]));
    worker.emit({ kind: "fs", identity: 2, method: "writeFile", args: ["/late", new Uint8Array([9])] });
    worker.emit({ kind: "state", cwd: "/late" });
    await expect(filesystem.stat("/late")).rejects.toMatchObject({ code: "ENOENT" });
    expect(state).toHaveBeenCalledTimes(1);
    const next = executeInWorker(filesystem, "echo next", "/", "help", state);
    expect(workers).toHaveLength(2);
    workers[1]!.emit({ kind: "ready" });
    workers[1]!.emit({ kind: "result", result: { stdout: "next\n", stderr: "", exitCode: 0 } });
    expect(await next).toMatchObject({ stdout: "next\n", exitCode: 0 });
    expect(workers[1]!.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "messageerror"])("fails closed on worker %s", async (event) => {
    const workers = controlledWorkers();
    const running = executeInWorker(createMemoryFileSystem(), "echo never", "/", "help", vi.fn());
    workers[0]!.dispatchEvent(Object.assign(new Event(event, { cancelable: true }), { message: "worker crashed" }));
    expect(await running).toMatchObject({ exitCode: 1, stdout: "" });
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed completion messages instead of returning an invalid result", async () => {
    const workers = controlledWorkers();
    const running = executeInWorker(createMemoryFileSystem(), "echo never", "/", "help", vi.fn());
    workers[0]!.emit({ kind: "ready" });
    workers[0]!.dispatchEvent(new MessageEvent("message", { data: { kind: "result" } }));
    expect(await running).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Invalid worker result") });
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it("owns and closes auxiliary workers when the execution deadline fires", async () => {
    const workers = controlledWorkers();
    const close = vi.fn();
    const auxiliary = Object.assign(new EventTarget(), { postMessage: vi.fn() });
    vi.spyOn(browserWorkerRuntime, "create").mockReturnValue({ worker: auxiliary, close });
    vi.useFakeTimers();
    const running = executeInWorker(createMemoryFileSystem(), "grep pattern", "/", "help", vi.fn());
    workers[0]!.emit({ kind: "ready" });
    workers[0]!.emit({ kind: "aux-create", identity: 1, worker: "regex", data: {} });
    workers[0]!.emit({ kind: "aux-message", identity: 1, value: { search: "pattern" } });
    expect(auxiliary.postMessage).toHaveBeenCalledWith({ search: "pattern" });
    auxiliary.dispatchEvent(new MessageEvent("message", { data: "matched" }));
    expect(workers[0]!.postMessage).toHaveBeenCalledWith({ kind: "aux-event", identity: 1, event: "message", value: "matched" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await running).toMatchObject({ exitCode: 124 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("kills synchronous work on a real worker without blocking the page and permits the next command", async () => {
    const fixture = browserWorkerFixture(`
      globalThis.addEventListener("message", ({data}) => {
        if (data.kind !== "start") return;
        if (data.command === "block") {
          globalThis.postMessage({kind:"state",cwd:"/busy"});
          while (true) {}
        }
        globalThis.postMessage({kind:"result",result:{stdout:"recovered",stderr:"",exitCode:0}});
      });
      globalThis.postMessage({kind:"ready"});
    `);
    vi.stubGlobal("Worker", fixture.Worker);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let started!: () => void;
    const busy = new Promise<void>((resolve) => { started = resolve; });
    const filesystem = createMemoryFileSystem();
    try {
      const running = executeInWorker(filesystem, "block", "/", "help", started);
      await busy;
      await delay(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await running).toMatchObject({ exitCode: 124 });
      await fixture.close();
      expect(fixture.workers.size).toBe(0);
      expect(await executeInWorker(filesystem, "next", "/", "help", vi.fn())).toMatchObject({ stdout: "recovered", exitCode: 0 });
    } finally {
      await fixture.close();
    }
  });
});
