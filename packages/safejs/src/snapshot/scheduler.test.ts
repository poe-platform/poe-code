import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { FileSnapshotBackend } = await import("./backend.js");
const { createSnapshotScheduler } = await import("./scheduler.js");
const { UnsnapshotableValueError } = await import("./serialize.js");
type SnapshotBackend = Awaited<typeof import("./backend.js")>["SnapshotBackend"];

describe("snapshot scheduler", () => {
  beforeEach(() => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing when snapshotPath is omitted", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const scheduler = createSnapshotScheduler<{ step: string }>({});

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      step: "ignored"
    }));
    await scheduler.finish();

    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("writes atomically at the next yield once the default interval has elapsed", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json"
    });

    scheduler.onYield(() => ({
      step: "too-early"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    vi.advanceTimersByTime(29_999);
    scheduler.onYield(() => ({
      step: "still-too-early"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "checkpointed"
    }));
    await scheduler.finish();

    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\/state\.json\..+\.tmp$/),
      JSON.stringify(
        {
          version: 1,
          step: "checkpointed"
        },
        null,
        2
      ),
      { encoding: "utf8", flag: "wx" }
    );
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\/state\.json\..+\.tmp$/),
      "/state.json"
    );
    expect(
      Object.keys(vol.toJSON()).some((filePath) => /^\/state\.json\..+\.tmp$/.test(filePath))
    ).toBe(false);
    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "checkpointed"
    });
  });

  it("surfaces an unsnapshotable periodic dump", async () => {
    const scheduler = createSnapshotScheduler<{ sourceHash: string }>({
      snapshotIntervalMs: 1_000,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async write(snapshot) {
          void snapshot;
          throw new UnsnapshotableValueError("bindings.generator");
        },
        async remove() {}
      }
    });

    vi.advanceTimersByTime(1_000);
    scheduler.onYield(() => ({ sourceHash: "skipped" }));
    await expect(scheduler.finish()).rejects.toMatchObject({
      name: "UnsnapshotableValueError",
      path: "bindings.generator"
    });
  });

  it("waits for an in-flight atomic write before starting the next scheduled write", async () => {
    const originalWriteFile = fs.writeFile;
    const firstWrite = createDeferred<void>();
    const writeSteps: string[] = [];
    vi.spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
      const step = JSON.parse(String(data)).step as string;
      writeSteps.push(step);
      if (step === "first") {
        await firstWrite.promise;
      }

      await originalWriteFile(path, data, options);
    });

    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotIntervalMs: 1,
      snapshotPath: "/state.json"
    });

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "first"
    }));
    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "second"
    }));

    await flushMicrotasks();
    expect(writeSteps).toEqual(["first"]);
    expect(vol.existsSync("/state.json")).toBe(false);

    firstWrite.resolve();
    await scheduler.finish();

    expect(writeSteps).toEqual(["first", "second"]);
    expect(vol.existsSync("/state.json.tmp")).toBe(false);
    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "second"
    });
  });

  it("respects a custom interval and waits for the next full period after each checkpoint", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotIntervalMs: 5_000,
      snapshotPath: "/state.json"
    });

    vi.advanceTimersByTime(5_000);
    scheduler.onYield(() => ({
      step: "first"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "first"
    });

    scheduler.onYield(() => ({
      step: "too-soon"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "first"
    });

    vi.advanceTimersByTime(4_999);
    scheduler.onYield(() => ({
      step: "still-too-soon"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "first"
    });

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "second"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "second"
    });
  });

  it("does not checkpoint on finish when no yield happens after the interval elapses", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json"
    });

    scheduler.onYield(() => ({
      step: "initial"
    }));
    vi.advanceTimersByTime(30_000);
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);
  });

  it("surfaces the underlying backend write error", async () => {
    const error = new Error("backend write failed");
    const scheduler = createSnapshotScheduler<{ sourceHash: string }>({
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async write() {
          throw error;
        },
        async remove() {}
      }
    });

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      sourceHash: "abc123"
    }));

    await expect(scheduler.finish()).rejects.toBe(error);
  });

  it("retries locked snapshot writes the configured number of times before failing clearly", async () => {
    const locked = createFsError("EBUSY", "resource busy or locked");
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(locked);
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json",
      snapshotWriteMaxAttempts: 3,
      snapshotWriteRetryDelayMs: 0
    });

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      step: "locked"
    }));

    await expect(scheduler.finish()).rejects.toThrow(
      "Failed to write snapshot at /state.json after 3 attempts: file is locked (EBUSY)"
    );
    expect(renameSpy).toHaveBeenCalledTimes(3);
    expect(vol.existsSync("/state.json.tmp")).toBe(false);
  });

  it("surfaces disk-full errors after draining queued writes and keeps later checkpoints moving", async () => {
    const originalWriteFile = fs.writeFile;
    const diskFull = createFsError("ENOSPC", "no space left on device");
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async () => {
      throw diskFull;
    });
    vi.mocked(fs.writeFile).mockImplementation(async (path, data, options) => {
      await originalWriteFile(path, data, options);
    });
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotIntervalMs: 1,
      snapshotPath: "/state.json"
    });

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "disk-full"
    }));
    await flushMicrotasks();
    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "after-recovery"
    }));

    await expect(scheduler.finish()).rejects.toThrow("no space left on device");
    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "after-recovery"
    });
  });

  it("fails clearly when the snapshot parent directory does not exist", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/missing-parent/state.json"
    });

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      step: "missing-parent"
    }));

    await expect(scheduler.finish()).rejects.toThrow(
      "Cannot write snapshot at /missing-parent/state.json: parent directory /missing-parent does not exist"
    );
    expect(vol.existsSync("/missing-parent/state.json")).toBe(false);
  });

  it("removes an orphan temp file when a scheduled write exits before rename completes", async () => {
    vi.spyOn(fs, "rename").mockRejectedValueOnce(createFsError("EIO", "rename failed"));
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json"
    });

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      step: "orphan"
    }));

    await expect(scheduler.finish()).rejects.toThrow("rename failed");
    expect(vol.existsSync("/state.json.tmp")).toBe(false);
  });

  it("pauses and resumes interval-based checkpointing", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotIntervalMs: 1_000,
      snapshotPath: "/state.json"
    });

    scheduler.pause();
    vi.advanceTimersByTime(1_000);
    scheduler.onYield(() => ({
      step: "paused"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    scheduler.resume();
    scheduler.onYield(() => ({
      step: "resumed-too-early"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    vi.advanceTimersByTime(1_000);
    scheduler.onYield(() => ({
      step: "resumed"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      version: 1,
      step: "resumed"
    });
  });

  it("serializes concurrent writes through the existing pending write lock", async () => {
    const firstWrite = createDeferred<void>();
    const writes: string[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const backend: SnapshotBackend = {
      async read() {
        return undefined;
      },
      async write(snapshot) {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        writes.push(snapshot.sourceHash);
        if (snapshot.sourceHash === "first") {
          await firstWrite.promise;
        }
        activeWrites -= 1;
      },
      async remove() {}
    };
    const scheduler = createSnapshotScheduler({
      snapshotBackend: backend
    });

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      sourceHash: "first"
    }));
    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      sourceHash: "second"
    }));

    await flushMicrotasks();
    expect(writes).toEqual(["first"]);

    firstWrite.resolve();
    await scheduler.finish();

    expect(writes).toEqual(["first", "second"]);
    expect(maxActiveWrites).toBe(1);
  });
});

describe("FileSnapshotBackend scheduler integration edges", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not create missing parent directories implicitly", async () => {
    const backend = new FileSnapshotBackend("/missing-parent/state.json");

    await expect(
      backend.write({
        sourceHash: "abc123"
      })
    ).rejects.toThrow(
      "Cannot write snapshot at /missing-parent/state.json: parent directory /missing-parent does not exist"
    );
    expect(vol.existsSync("/missing-parent")).toBe(false);
  });
});

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function createFsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
