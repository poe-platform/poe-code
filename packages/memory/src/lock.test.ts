import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withLock, type LockOptions } from "./lock.js";

type TestFs = NonNullable<LockOptions["fs"]>;

function createFs(files: Record<string, string> = {}): { fs: TestFs; volume: Volume } {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises as unknown as TestFs;
  return { fs, volume };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withLock", () => {
  it("creates the memory lock file for the duration of the callback and removes it afterwards", async () => {
    const root = "/repo/.poe-code/memory";
    const { fs } = createFs({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n"
    });

    await expect(
      withLock(
        root,
        async () => {
          await expect(fs.readFile("/repo/.poe-code/memory/.lock", "utf8")).resolves.toBe("123\n");
          return "done";
        },
        {
          fs,
          pid: 123
        }
      )
    ).resolves.toBe("done");

    await expect(fs.readFile("/repo/.poe-code/memory/.lock", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("serializes concurrent callers until the active lock holder finishes", async () => {
    vi.useFakeTimers();
    const root = "/repo/.poe-code/memory";
    const { fs } = createFs({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n"
    });

    const events: string[] = [];
    let signalFirstStarted: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });

    const firstPromise = withLock(
      root,
      async () => {
        events.push("first:start");
        signalFirstStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
      },
      {
        fs,
        pid: 101,
        retries: 5,
        minTimeoutMs: 10,
        maxTimeoutMs: 10,
        isPidRunning: () => true
      }
    );

    await firstStarted;

    const secondPromise = withLock(
      root,
      async () => {
        events.push("second:start");
      },
      {
        fs,
        pid: 202,
        retries: 5,
        minTimeoutMs: 10,
        maxTimeoutMs: 10,
        isPidRunning: () => true
      }
    );

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);

    await firstPromise;
    await secondPromise;

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("steals a stale lock when the recorded pid is no longer running", async () => {
    const root = "/repo/.poe-code/memory";
    const { fs } = createFs({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n",
      "/repo/.poe-code/memory/.lock": "999\n"
    });

    await withLock(
      root,
      async () => {
        await expect(fs.readFile("/repo/.poe-code/memory/.lock", "utf8")).resolves.toBe("123\n");
      },
      {
        fs,
        pid: 123,
        isPidRunning: (pid) => pid === 123
      }
    );
  });

  it("releases the lock when the callback throws", async () => {
    const root = "/repo/.poe-code/memory";
    const { fs } = createFs({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n"
    });

    await expect(
      withLock(
        root,
        async () => {
          throw new Error("boom");
        },
        {
          fs,
          pid: 123
        }
      )
    ).rejects.toThrow("boom");

    await expect(fs.readFile("/repo/.poe-code/memory/.lock", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
