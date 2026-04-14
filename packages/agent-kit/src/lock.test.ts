import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockWorkflow, type LockOptions } from "./lock.js";

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

describe("lockWorkflow", () => {
  it("creates the lock directory next to the workflow doc", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    const unlock = await lockWorkflow("/repo/workflow.md", { fs });

    await expect(fs.stat("/repo/workflow.md.lock")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await unlock();
  });

  it("removes the lock directory when unlocked", async () => {
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    const unlock = await lockWorkflow("/repo/workflow.md", { fs });
    await unlock();

    await expect(fs.stat("/repo/workflow.md.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("retries a concurrent lock attempt until the first lock is released", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fs } = createFs({ "/repo/workflow.md": "# workflow" });

    const firstUnlock = await lockWorkflow("/repo/workflow.md", {
      fs,
      minTimeout: 10,
      maxTimeout: 10,
      retries: 2
    });

    const secondLockPromise = lockWorkflow("/repo/workflow.md", {
      fs,
      minTimeout: 10,
      maxTimeout: 10,
      retries: 2
    });

    await Promise.resolve();
    await firstUnlock();
    await vi.advanceTimersByTimeAsync(10);

    const secondUnlock = await secondLockPromise;
    await secondUnlock();
  });

  it("cleans up a stale lock before acquiring a new one", async () => {
    vi.setSystemTime(new Date("2026-04-13T12:00:00.000Z"));
    const { fs, volume } = createFs({ "/repo/workflow.md": "# workflow" });

    volume.mkdirSync("/repo/workflow.md.lock", { recursive: true });
    volume.utimesSync("/repo/workflow.md.lock", new Date("2026-04-13T11:58:00.000Z"), new Date("2026-04-13T11:58:00.000Z"));

    const unlock = await lockWorkflow("/repo/workflow.md", {
      fs,
      staleMs: 30_000
    });

    await expect(fs.stat("/repo/workflow.md.lock")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await unlock();
  });

  it("derives the lock path by appending .lock to the doc path", async () => {
    const { fs } = createFs({ "/repo/plans/alpha.yaml": "tasks: []\n" });

    const unlock = await lockWorkflow("/repo/plans/alpha.yaml", { fs });

    await expect(fs.stat("/repo/plans/alpha.yaml.lock")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await expect(fs.stat("/repo/plans/alpha.lock")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await unlock();
  });
});
