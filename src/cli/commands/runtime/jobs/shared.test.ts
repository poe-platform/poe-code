import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEntry, StateManager } from "@poe-code/poe-code-config/core";
import type { JobHandle, LogChunk } from "@poe-code/process-runner";
import { resolveJob, streamJobLog, waitForGracefulStop } from "./shared.js";
import { ValidationError } from "../../../errors.js";

function job(overrides: Partial<JobEntry> & Pick<JobEntry, "id" | "started_at">): JobEntry {
  return {
    env_id: `env-${overrides.id}`,
    env_kind: "docker",
    tool: "codex",
    argv: ["codex"],
    cwd: "/repo",
    status: "running",
    ...overrides
  };
}

function createState(entries: JobEntry[]): StateManager {
  return {
    jobs: {
      async list() {
        return entries;
      },
      async get(id: string) {
        return entries.find((entry) => entry.id === id) ?? null;
      }
    }
  } as unknown as StateManager;
}

describe("streamJobLog", () => {
  const next = vi.fn<() => Promise<IteratorResult<LogChunk>>>();
  const finish = vi.fn<() => Promise<IteratorResult<LogChunk>>>();
  const status = vi.fn<JobHandle["status"]>();
  const stream = vi.fn<JobHandle["stream"]>(() => ({
    [Symbol.asyncIterator]: () => ({ next, return: finish })
  }));
  const handle: JobHandle = {
    id: "job-logs",
    envId: "container-id",
    tool: "node",
    argv: ["node"],
    status,
    stream,
    wait: vi.fn(),
    kill: vi.fn()
  };

  beforeEach(() => {
    vi.useFakeTimers();
    next.mockReset().mockResolvedValue({ done: true, value: undefined });
    finish.mockReset().mockResolvedValue({ done: true, value: undefined });
    status.mockReset().mockResolvedValue("running");
    stream.mockReset().mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({ next, return: finish })
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["exited", "killed", "lost"] as const)("drains all delayed chunks after terminal status %s", async (terminalStatus) => {
    status.mockResolvedValue(terminalStatus);
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "first\n" } }), 300);
    })).mockResolvedValueOnce({ done: false, value: { byteOffset: 6, data: "last\n" } });
    const write = vi.fn();
    const reading = streamJobLog(handle, { follow: true, write });

    await vi.advanceTimersByTimeAsync(300);
    await reading;

    expect(write.mock.calls).toEqual([["first\n"], ["last\n"]]);
    expect(stream).toHaveBeenCalledExactlyOnceWith({ sinceByte: 0, follow: true, signal: expect.any(AbortSignal) });
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a final chunk error after terminal status and closes the iterator", async () => {
    const failure = new Error("Final stream read failed");
    status.mockResolvedValue("exited");
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "first\n" } }), 300);
    })).mockRejectedValueOnce(failure);
    const write = vi.fn();
    const completion = streamJobLog(handle, { follow: true, write }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(300);
    expect(await completion).toBe(failure);

    expect(write.mock.calls).toEqual([["first\n"]]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("continues polling running jobs until their iterator completes", async () => {
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "output\n" } }), 600);
    }));
    const write = vi.fn();
    const reading = streamJobLog(handle, { follow: true, write });

    await vi.advanceTimersByTimeAsync(600);
    await reading;

    expect(write.mock.calls).toEqual([["output\n"]]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("consumes a non-follow snapshot without polling status", async () => {
    const since = new Date("2026-08-26T00:00:00.000Z");
    next.mockResolvedValueOnce({ done: false, value: { byteOffset: 0, data: "first\n" } })
      .mockResolvedValueOnce({ done: false, value: { byteOffset: 6, data: "last\n" } });
    const write = vi.fn();

    await streamJobLog(handle, { follow: false, since, write });

    expect(write.mock.calls).toEqual([["first\n"], ["last\n"]]);
    expect(stream).toHaveBeenCalledExactlyOnceWith({ since, follow: false, signal: expect.any(AbortSignal) });
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["read", "status", "drain"])(
    "detaches during a blocked %s and awaits reader cleanup",
    async (phase) => {
      const closed = vi.fn();
      const detached = vi.fn();
      const settled = vi.fn();
      let releaseRead = () => {};
      let releaseStatus = () => {};
      let iterator!: AsyncGenerator<LogChunk>;
      const cancellable: JobHandle = {
        ...handle,
        stream(options) {
          iterator = (async function* () {
            try {
              await new Promise<void>((resolve, reject) => {
                releaseRead = resolve;
                options?.signal?.addEventListener(
                  "abort",
                  () => {
                    setTimeout(() => reject(options.signal?.reason), 10);
                  },
                  { once: true }
                );
              });
              yield { byteOffset: 0, data: "late output\n" };
            } finally {
              closed();
            }
          })();
          vi.spyOn(iterator, "return");
          return iterator;
        }
      };
      if (phase === "status") {
        status.mockImplementation(
          (options) =>
            new Promise((resolve, reject) => {
              releaseStatus = () => resolve("running");
              options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
                once: true
              });
            })
        );
      } else if (phase === "drain") {
        status.mockResolvedValue("exited");
      }
      const write = vi.fn();
      const listeners = process.listenerCount("SIGINT");
      const reading = streamJobLog(cancellable, { follow: true, write, onDetach: detached }).then(
        () => settled("done"),
        (error: unknown) => settled(error)
      );
      try {
        await vi.advanceTimersByTimeAsync(phase === "read" ? 0 : 250);
        process.emit("SIGINT");
        await vi.advanceTimersByTimeAsync(0);
        expect(detached).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10);

        expect(settled).toHaveBeenCalledExactlyOnceWith("done");
        expect(closed).toHaveBeenCalledTimes(1);
        expect(iterator.return).toHaveBeenCalledTimes(1);
        expect(write).not.toHaveBeenCalled();
        expect(handle.kill).not.toHaveBeenCalled();
        expect(process.listenerCount("SIGINT")).toBe(listeners);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        releaseRead();
        releaseStatus();
        await vi.advanceTimersByTimeAsync(1000);
        await reading;
        vi.restoreAllMocks();
      }
    }
  );

  it("clears polling timers when an immediate stream completes", async () => {
    await streamJobLog(handle, { follow: true, write: vi.fn() });
    expect(vi.getTimerCount()).toBe(0);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending reader when status fails and preserves the failure", async () => {
    const failure = new Error("Status failed");
    const settled = vi.fn();
    let releaseRead = () => {};
    const cancellable: JobHandle = {
      ...handle,
      async *stream(options) {
        await new Promise<void>((resolve, reject) => {
          releaseRead = resolve;
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true
          });
        });
        yield { byteOffset: 0, data: "late output\n" };
      }
    };
    status.mockRejectedValue(failure);
    const reading = streamJobLog(cancellable, { follow: true, write: vi.fn() }).then(
      () => settled("done"),
      (error: unknown) => settled(error)
    );
    try {
      await vi.advanceTimersByTimeAsync(250);
      expect(settled).toHaveBeenCalledExactlyOnceWith(failure);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      releaseRead();
      await vi.advanceTimersByTimeAsync(1000);
      await reading;
    }
  });

  it("propagates iterator cleanup failures after manual detach", async () => {
    const failure = new Error("Iterator cleanup failed");
    const settled = vi.fn();
    let releaseRead = () => {};
    let signal: AbortSignal | undefined;
    stream.mockImplementation((options) => {
      signal = options?.signal;
      return { [Symbol.asyncIterator]: () => ({ next, return: finish }) };
    });
    next.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          releaseRead = () => resolve({ done: true, value: undefined });
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        })
    );
    finish.mockImplementation(() => {
      const failed = Promise.reject<IteratorResult<LogChunk>>(failure);
      void failed.catch(() => undefined);
      return failed;
    });
    const reading = streamJobLog(handle, { follow: true, write: vi.fn(), onDetach: vi.fn() }).then(
      () => settled("done"),
      (error: unknown) => settled(error)
    );
    try {
      process.emit("SIGINT");
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledExactlyOnceWith(failure);
      expect(finish).toHaveBeenCalledTimes(1);
    } finally {
      releaseRead();
      await vi.advanceTimersByTimeAsync(1000);
      await reading;
    }
  });
});

describe("waitForGracefulStop timer cleanup", () => {
  const wait = vi.fn<JobHandle["wait"]>();
  const kill = vi.fn<JobHandle["kill"]>();
  const handle: JobHandle = {
    id: "job-stop",
    envId: "container-id",
    tool: "node",
    argv: ["node"],
    status: vi.fn(),
    stream: vi.fn(),
    wait,
    kill
  };

  beforeEach(() => {
    vi.useFakeTimers();
    wait.mockReset().mockResolvedValue({ exitCode: 0 });
    kill.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])("clears the default grace timer on exit (stalled SIGTERM: %s)", async (stalled) => {
    if (stalled) {
      kill.mockImplementation(() => new Promise(() => {}));
    }

    await waitForGracefulStop(handle);

    expect(wait).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a wait error and clears the grace timer", async () => {
    const failure = new Error("wait failed");
    wait.mockRejectedValue(failure);

    await expect(waitForGracefulStop(handle)).rejects.toBe(failure);

    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a SIGTERM error and clears the grace timer", async () => {
    const failure = new Error("SIGTERM failed");
    wait.mockImplementation(() => new Promise(() => {}));
    kill.mockRejectedValue(failure);

    await expect(waitForGracefulStop(handle)).rejects.toBe(failure);

    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("escalates only after grace expires (stalled SIGTERM: %s)", async (stalled) => {
    let completeExit: ((result: { exitCode: number }) => void) | undefined;
    wait.mockReturnValue(new Promise((resolve) => {
      completeExit = resolve;
    }));
    kill.mockImplementation(async (signal) => {
      if (signal === "SIGKILL") {
        completeExit?.({ exitCode: 137 });
      } else if (stalled) {
        await new Promise(() => {});
      }
    });
    const stopping = waitForGracefulStop(handle, 800);

    expect(wait).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a SIGKILL error after grace expiry", async () => {
    const failure = new Error("SIGKILL failed");
    wait.mockImplementation(() => new Promise(() => {}));
    kill.mockImplementation(async (signal) => {
      if (signal === "SIGKILL") {
        throw failure;
      }
    });
    const stopping = waitForGracefulStop(handle, 800).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(800);

    expect(await stopping).toBe(failure);
    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still tolerates a wait rejection after SIGKILL", async () => {
    const failure = new Error("wait failed after kill");
    let rejectExit: ((error: unknown) => void) | undefined;
    wait.mockReturnValue(new Promise((_resolve, reject) => {
      rejectExit = reject;
    }));
    kill.mockImplementation(async (signal) => {
      if (signal === "SIGKILL") {
        rejectExit?.(failure);
      }
    });
    const stopping = waitForGracefulStop(handle, 800);

    await vi.advanceTimersByTimeAsync(800);
    await expect(stopping).resolves.toBeUndefined();

    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("resolveJob", () => {
  it("defaults to the unambiguously most recent candidate instead of erroring", async () => {
    const state = createState([
      job({ id: "old", started_at: "2026-06-16T10:00:00.000Z" }),
      job({ id: "newest", started_at: "2026-07-08T10:00:00.000Z" }),
      job({ id: "middle", started_at: "2026-06-25T10:00:00.000Z" })
    ]);

    await expect(resolveJob(state, undefined, "running")).resolves.toMatchObject({ id: "newest" });
  });

  it("caps the candidate list and reports a user error when the newest match is ambiguous", async () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      job({ id: `job-${index}`, started_at: "2026-07-08T10:00:00.000Z" })
    );
    const state = createState(entries);

    const error = await resolveJob(state, undefined, "pullable").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ValidationError);
    const message = (error as Error).message;
    expect(message.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(message).toContain("3 more");
  });
});
