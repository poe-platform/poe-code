import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { attachSignalDumpHandler } from "./signal-dump.js";

describe("runner signal dump handling", () => {
  it("waits for dump() to resolve before exiting on SIGINT", async () => {
    const snapshot = JSON.stringify({ sourceHash: "abc" }, null, 2);
    const dumpResult = createDeferred<string>();
    const process = createProcessDouble();
    const onSnapshot = vi.fn();

    attachSignalDumpHandler(Promise.resolve({} as never), {
      dumpResult: vi.fn(() => dumpResult.promise),
      onSnapshot,
      process
    });

    process.emit("SIGINT");
    await flushMicrotasks();

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(0);

    dumpResult.resolve(snapshot);
    await flushMicrotasks();

    expect(onSnapshot).toHaveBeenCalledWith(snapshot, "SIGINT");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("exits with code 1 when dump() rejects", async () => {
    const failure = new Error("dump failed");
    const process = createProcessDouble();
    const onError = vi.fn();

    attachSignalDumpHandler(Promise.resolve({} as never), {
      dumpResult: vi.fn(() => Promise.reject(failure)),
      onError,
      process
    });

    process.emit("SIGTERM");
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(failure, "SIGTERM");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("ignores repeated signals after shutdown starts", async () => {
    const dumpResult = createDeferred<string>();
    const process = createProcessDouble();
    const dumpSpy = vi.fn(() => dumpResult.promise);

    attachSignalDumpHandler(Promise.resolve({} as never), {
      dumpResult: dumpSpy,
      process
    });

    process.emit("SIGINT");
    process.emit("SIGTERM");
    await flushMicrotasks();

    expect(dumpSpy).toHaveBeenCalledTimes(1);

    dumpResult.resolve("{}");
    await flushMicrotasks();

    expect(process.exit).toHaveBeenCalledTimes(1);
  });
});

function createProcessDouble() {
  const process = new EventEmitter() as EventEmitter & {
    exit: ReturnType<typeof vi.fn>;
  };

  process.exit = vi.fn();

  return process;
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
