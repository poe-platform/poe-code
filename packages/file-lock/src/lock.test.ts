import * as os from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireFileLock,
  LockTimeoutError,
  type FileLockFs,
  type FileLockOptions
} from "./lock.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): {
  fs: FileLockFs;
  rawFs: TestFs;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;
  return {
    fs: rawFs as unknown as FileLockFs,
    rawFs,
    volume
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForAcquireToSettle(): Promise<void> {
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(0);
}

describe("acquireFileLock", () => {
  it("acquires a fresh lock and releases it cleanly", async () => {
    const { fs, rawFs } = createFs({ "/repo/workflow.md": "# workflow\n" });

    const release = await acquireFileLock("/repo/workflow.md", { fs });

    await expect(rawFs.stat("/repo/workflow.md.lock")).resolves.toMatchObject({
      mtimeMs: expect.any(Number)
    });

    await release();

    await expect(rawFs.stat("/repo/workflow.md.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("allows exactly one concurrent acquire to win until that winner releases", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fs, rawFs } = createFs({ "/repo/workflow.md": "# workflow\n" });
    const options: FileLockOptions = {
      fs,
      retries: 5,
      minTimeout: 10,
      maxTimeout: 10
    };

    let firstAcquired = false;
    let secondAcquired = false;

    const firstLockPromise = acquireFileLock("/repo/workflow.md", options).then((release) => {
      firstAcquired = true;
      return release;
    });
    const secondLockPromise = acquireFileLock("/repo/workflow.md", options).then((release) => {
      secondAcquired = true;
      return release;
    });

    await waitForAcquireToSettle();
    expect(Number(firstAcquired) + Number(secondAcquired)).toBe(1);
    await expect(rawFs.stat("/repo/workflow.md.lock")).resolves.toMatchObject({
      mtimeMs: expect.any(Number)
    });

    const winnerPromise = firstAcquired ? firstLockPromise : secondLockPromise;
    const loserPromise = firstAcquired ? secondLockPromise : firstLockPromise;
    const winnerRelease = await winnerPromise;

    await winnerRelease();
    await vi.advanceTimersByTimeAsync(10);

    const loserRelease = await loserPromise;
    expect(firstAcquired).toBe(true);
    expect(secondAcquired).toBe(true);

    await loserRelease();
  });

  it("reclaims a stale lock", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
    const { fs, rawFs, volume } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": "{\"pid\":1}\n"
    });

    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-04-26T11:58:00.000Z"),
      new Date("2026-04-26T11:58:00.000Z")
    );

    const release = await acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: 30_000
    });

    const content = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    expect(JSON.parse(content)).toMatchObject({
      pid: process.pid
    });

    await release();
  });

  it("uses a 1s default stale lock window", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:02.000Z"));
    const { fs, rawFs, volume } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": "{\"pid\":1}\n"
    });

    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-04-26T12:00:00.999Z"),
      new Date("2026-04-26T12:00:00.999Z")
    );

    const release = await acquireFileLock("/repo/workflow.md", { fs });

    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      `"pid":${process.pid}`
    );

    await release();
  });

  it("reclaims a stale lock even when retries is zero", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
    const { fs, rawFs, volume } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": "{\"pid\":1}\n"
    });

    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-04-26T11:58:00.000Z"),
      new Date("2026-04-26T11:58:00.000Z")
    );

    const release = await acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: 30_000,
      retries: 0
    });

    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      `"pid":${process.pid}`
    );

    await release();
  });

  it("reclaims a lock immediately when metadata points at a stopped local pid", async () => {
    const { fs, rawFs } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": JSON.stringify({
        pid: 999,
        host: os.hostname(),
        acquiredAt: "2026-04-26T12:00:00.000Z"
      })
    });

    const release = await acquireFileLock("/repo/workflow.md", {
      fs,
      staleMs: Number.POSITIVE_INFINITY,
      isPidRunning: () => false
    });

    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      `"pid":${process.pid}`
    );

    await release();
  });

  it("keeps an mtime-stale lock when metadata points at a running local pid", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
    const { fs, rawFs, volume } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": JSON.stringify({
        pid: 123,
        host: os.hostname(),
        acquiredAt: "2026-04-26T11:58:00.000Z"
      })
    });

    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-04-26T11:58:00.000Z"),
      new Date("2026-04-26T11:58:00.000Z")
    );

    await expect(
      acquireFileLock("/repo/workflow.md", {
        fs,
        staleMs: 30_000,
        retries: 0,
        isPidRunning: (pid) => pid === 123
      })
    ).rejects.toBeInstanceOf(LockTimeoutError);

    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      '"pid":123'
    );
  });

  it("retries transient EPERM errors while removing a stale lock", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
    const { fs, rawFs, volume } = createFs({
      "/repo/workflow.md": "# workflow\n",
      "/repo/workflow.md.lock": "{\"pid\":1}\n"
    });
    let unlinkAttempts = 0;
    const flakyFs: FileLockFs = {
      ...fs,
      unlink: async (filePath) => {
        unlinkAttempts += 1;
        if (unlinkAttempts === 1) {
          const error = new Error("operation not permitted") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }

        await fs.unlink(filePath);
      }
    };

    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-04-26T11:58:00.000Z"),
      new Date("2026-04-26T11:58:00.000Z")
    );

    const release = await acquireFileLock("/repo/workflow.md", {
      fs: flakyFs,
      staleMs: 30_000,
      minTimeout: 0
    });

    expect(unlinkAttempts).toBe(2);
    await expect(rawFs.readFile("/repo/workflow.md.lock", "utf8")).resolves.toContain(
      `"pid":${process.pid}`
    );

    await release();
  });

  it("throws LockTimeoutError when retries are exhausted", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fs } = createFs({ "/repo/workflow.md": "# workflow\n" });

    const firstRelease = await acquireFileLock("/repo/workflow.md", {
      fs,
      retries: 2,
      minTimeout: 10,
      maxTimeout: 10
    });

    const secondLockPromise = expect(
      acquireFileLock("/repo/workflow.md", {
        fs,
        retries: 2,
        minTimeout: 10,
        maxTimeout: 10
      })
    ).rejects.toBeInstanceOf(LockTimeoutError);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);

    await secondLockPromise;

    await firstRelease();
  });

  it("writes valid lock metadata json", async () => {
    vi.setSystemTime(new Date("2026-04-26T12:34:56.000Z"));
    const { fs, rawFs } = createFs({ "/repo/workflow.md": "# workflow\n" });

    const release = await acquireFileLock("/repo/workflow.md", { fs });
    const content = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    const parsed = JSON.parse(content) as {
      acquiredAt: string;
      host: string;
      pid: number;
    };

    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.host).toBe("string");
    expect(parsed.host.length).toBeGreaterThan(0);
    expect(parsed.acquiredAt).toBe("2026-04-26T12:34:56.000Z");

    await release();
  });

  it("keeps the lock when metadata writing fails", async () => {
    const { fs, rawFs } = createFs({ "/repo/workflow.md": "# workflow\n" });
    const faultyFs: FileLockFs = {
      ...fs,
      open: async (path, flags) => {
        const handle = await fs.open(path, flags);
        return {
          close: () => handle.close(),
          writeFile: async () => {
            throw new Error("write failed");
          }
        };
      }
    };

    const release = await acquireFileLock("/repo/workflow.md", { fs: faultyFs });

    await expect(rawFs.stat("/repo/workflow.md.lock")).resolves.toMatchObject({
      mtimeMs: expect.any(Number)
    });

    await release();

    await expect(rawFs.stat("/repo/workflow.md.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("tolerates ENOENT during release", async () => {
    const { fs, rawFs } = createFs({ "/repo/workflow.md": "# workflow\n" });

    const release = await acquireFileLock("/repo/workflow.md", { fs });

    await rawFs.unlink("/repo/workflow.md.lock");

    await expect(release()).resolves.toBeUndefined();
    await expect(release()).resolves.toBeUndefined();
  });

  it("cancels acquisition when the abort signal fires mid-retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fs } = createFs({ "/repo/workflow.md": "# workflow\n" });
    const abortController = new AbortController();

    const firstRelease = await acquireFileLock("/repo/workflow.md", {
      fs,
      retries: 5,
      minTimeout: 10,
      maxTimeout: 10
    });

    const secondLockPromise = expect(
      acquireFileLock("/repo/workflow.md", {
        fs,
        retries: 5,
        minTimeout: 10,
        maxTimeout: 10,
        signal: abortController.signal
      })
    ).rejects.toMatchObject({
      name: "AbortError"
    });

    await Promise.resolve();
    abortController.abort();

    await secondLockPromise;

    await firstRelease();
  });

  it("fails immediately when the signal is already aborted", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow\n" });
    const abortController = new AbortController();

    abortController.abort();

    await expect(
      acquireFileLock("/repo/workflow.md", {
        fs,
        signal: abortController.signal
      })
    ).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});
