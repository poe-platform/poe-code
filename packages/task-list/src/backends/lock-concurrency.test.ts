import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskListFs } from "../types.js";
import { createDeferred, createFs } from "./test-helpers.js";
import { withFileLock } from "./utils.js";

const lockPath = "/repo/tasks.yaml.lock";

describe("filesystem lock ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not running"), { code: "ESRCH" });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("excludes a distinct wrapper while the owner's empty lock is initializing", async () => {
    const { fs, rawFs } = createFs();
    const initialized = createDeferred();
    const initialize = createDeferred();
    const finish = createDeferred();
    const firstOperation = vi.fn(async () => {
      await finish.promise;
      return "first";
    });
    const secondOperation = vi.fn(async () => "second");
    const firstFs: TaskListFs = {
      ...fs,
      async mkdir(target, options) {
        await fs.mkdir(target, options);
        if (target === lockPath) {
          initialized.resolve();
          await initialize.promise;
        }
      },
      async writeFile(target, data, options) {
        if (target === lockPath) {
          await fs.writeFile(target, "", options);
          initialized.resolve();
          await initialize.promise;
          return fs.writeFile(target, data);
        }
        return fs.writeFile(target, data, options);
      }
    };
    const first = withFileLock(firstFs, lockPath, firstOperation);
    await initialized.promise;
    const second = withFileLock({ ...fs }, lockPath, secondOperation);
    const results = Promise.allSettled([first, second]);
    await vi.advanceTimersByTimeAsync(10);
    const enteredDuringInitialization = secondOperation.mock.calls.length;
    initialize.resolve();
    await vi.advanceTimersByTimeAsync(10);
    const enteredDuringOperation = secondOperation.mock.calls.length;
    finish.resolve();
    await vi.advanceTimersByTimeAsync(10);

    expect(await results).toEqual([
      { status: "fulfilled", value: "first" },
      { status: "fulfilled", value: "second" }
    ]);
    expect(enteredDuringInitialization).toBe(0);
    expect(enteredDuringOperation).toBe(0);
    await expect(rawFs.lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never lets two stale observers unlink a replacement owner (ABA)", async () => {
    const { fs, rawFs, volume } = createFs({ [lockPath]: "not-a-pid" });
    const observed = createDeferred();
    const resume = createDeferred();
    const ownerEntered = createDeferred();
    const finishOwner = createDeferred();
    let observations = 0;
    const contenderFs: TaskListFs = {
      ...fs,
      async mkdir(target, options) {
        try {
          await fs.mkdir(target, options);
        } catch (error) {
          if (target === lockPath && observations < 2) {
            observations += 1;
            if (observations === 2) observed.resolve();
            await resume.promise;
          }
          throw error;
        }
      },
      async readFile(target, encoding) {
        const content = await fs.readFile(target, encoding);
        if (target === lockPath && observations < 2) {
          observations += 1;
          if (observations === 2) observed.resolve();
          await resume.promise;
        }
        return content;
      }
    };
    const operation = vi.fn();
    const results = Promise.allSettled([
      withFileLock({ ...contenderFs }, lockPath, operation),
      withFileLock({ ...contenderFs }, lockPath, operation)
    ]);
    await observed.promise;
    await rawFs.unlink(lockPath);
    const owner = Promise.allSettled([withFileLock({ ...fs }, lockPath, async () => {
      ownerEntered.resolve();
      await finishOwner.promise;
      return "replacement owner";
    })]);
    await ownerEntered.promise;
    resume.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    const ownerStillPresent = volume.existsSync(lockPath);
    finishOwner.resolve();
    const ownerResult = await owner;

    expect(await results).toEqual([0, 1].map(() => ({
      status: "rejected",
      reason: expect.objectContaining({ message: expect.stringContaining("Timed out") })
    })));
    expect(operation).not.toHaveBeenCalled();
    expect(ownerStillPresent).toBe(true);
    expect(ownerResult).toEqual([{ status: "fulfilled", value: "replacement owner" }]);
    await expect(rawFs.lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses bounded timer delays without stealing an empty directory", async () => {
    const { fs, rawFs } = createFs();
    await rawFs.mkdir(lockPath, { recursive: true });
    const attempts: number[] = [];
    const operation = vi.fn();
    const contenderFs: TaskListFs = {
      ...fs,
      async mkdir(target, options) {
        if (target === lockPath) attempts.push(Date.now());
        await fs.mkdir(target, options);
      }
    };
    let settled = false;
    const result = withFileLock(contenderFs, lockPath, operation).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[1] - attempts[0]).toBe(10);
    await vi.advanceTimersByTimeAsync(29_980);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toEqual(expect.objectContaining({ message: expect.stringContaining("Timed out") }));
    expect(attempts).toHaveLength(3001);
    expect(operation).not.toHaveBeenCalled();
    expect(await rawFs.readdir(lockPath)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["empty", "owned", "legacy", "symlink"])("preserves a %s replacement during release", async (replacement) => {
    const { fs, rawFs, volume } = createFs({ "/outside/keep": "safe" });
    const result = withFileLock(fs, lockPath, async () => {
      volume.renameSync(lockPath, `${lockPath}.original`);
      if (replacement === "legacy") await rawFs.writeFile(lockPath, "foreign");
      else if (replacement === "symlink") volume.symlinkSync("/outside", lockPath);
      else {
        await rawFs.mkdir(lockPath);
        if (replacement === "owned") await rawFs.mkdir(`${lockPath}/foreign`);
      }
      return "operation completed";
    });

    await expect(result).rejects.toThrow();
    expect(volume.existsSync(lockPath)).toBe(true);
    expect(volume.readFileSync("/outside/keep", "utf8")).toBe("safe");
    if (replacement === "symlink") expect(volume.lstatSync(lockPath).isSymbolicLink()).toBe(true);
    else if (replacement === "legacy") expect(volume.readFileSync(lockPath, "utf8")).toBe("foreign");
    else expect(await rawFs.readdir(lockPath)).toEqual(replacement === "owned" ? ["foreign"] : []);
  });

  it.each([false, true])("leaves an unproven lock intact when marker initialization fails (replacement: %s)", async (replace) => {
    const { fs, rawFs, volume } = createFs();
    const failure = new Error("marker creation failed");
    const operation = vi.fn();
    const failingFs = {
      ...fs,
      async mkdir(target: string, options?: { recursive?: boolean }) {
        if (target.startsWith(`${lockPath}/`)) {
          if (replace) {
            volume.renameSync(lockPath, `${lockPath}.original`);
            await rawFs.mkdir(lockPath);
          }
          throw failure;
        }
        await fs.mkdir(target, options);
      }
    };
    await expect(withFileLock(failingFs, lockPath, operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect(await rawFs.readdir(lockPath)).toEqual([]);
  });

  it("does not clean up an ambiguously created owner marker", async () => {
    const { fs, rawFs } = createFs();
    const failure = Object.assign(new Error("marker acknowledgement failed"), { code: "EIO" });
    const operation = vi.fn();
    const failingFs: TaskListFs = {
      ...fs,
      async mkdir(target, options) {
        await fs.mkdir(target, options);
        if (target.startsWith(`${lockPath}/`)) throw failure;
      }
    };
    await expect(withFileLock(failingFs, lockPath, operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect(await rawFs.readdir(lockPath)).toHaveLength(1);
  });

  it.each(["lock", "ancestor", "dangling"])("rejects a %s symlink without touching its target", async (kind) => {
    const { fs, rawFs, volume } = createFs({ "/outside/keep": "safe", "/repo/keep": "safe" });
    const target = kind === "ancestor" ? "/repo/link/tasks.lock" : lockPath;
    volume.symlinkSync(kind === "dangling" ? "/missing" : "/outside", kind === "ancestor" ? "/repo/link" : target);
    const operation = vi.fn();
    await expect(withFileLock(fs, target, operation)).rejects.toThrow("symbolic link");
    expect(operation).not.toHaveBeenCalled();
    expect(await rawFs.readdir("/outside")).toEqual(["keep"]);
    expect(volume.lstatSync(kind === "ancestor" ? "/repo/link" : target).isSymbolicLink()).toBe(true);
  });

  it("rejects an owner-marker symlink on release", async () => {
    const { fs, rawFs, volume } = createFs({ "/outside/keep": "safe" });
    await expect(withFileLock(fs, lockPath, async () => {
      const [owner] = await rawFs.readdir(lockPath);
      await rawFs.rmdir(`${lockPath}/${owner}`);
      volume.symlinkSync("/outside", `${lockPath}/${owner}`);
    })).rejects.toThrow("symbolic link");
    expect(await rawFs.readdir("/outside")).toEqual(["keep"]);
    expect(volume.existsSync(lockPath)).toBe(true);
  });

  it.each(["acquire", "release"])("propagates lstat errors during %s without removing the lock", async (phase) => {
    const { fs, rawFs } = createFs();
    const failure = Object.assign(new Error("inspection denied"), { code: "EACCES" });
    let fail = phase === "acquire";
    if (fail) await rawFs.mkdir(lockPath, { recursive: true });
    const failingFs: TaskListFs = {
      ...fs,
      async lstat(target) {
        if (fail && target === lockPath) throw failure;
        return fs.lstat(target);
      }
    };
    const operation = vi.fn(async () => { fail = true; });
    await expect(withFileLock(failingFs, lockPath, operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(phase === "acquire" ? 0 : 1);
    expect((await rawFs.stat(lockPath)).isDirectory()).toBe(true);
  });

  it("checks symlinks again after waiting for contention", async () => {
    const { fs, rawFs, volume } = createFs({ "/outside/keep": "safe" });
    await rawFs.mkdir(lockPath, { recursive: true });
    const operation = vi.fn();
    const result = withFileLock(fs, lockPath, operation).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    await rawFs.rmdir(lockPath);
    volume.symlinkSync("/outside", lockPath);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toEqual(expect.objectContaining({ message: expect.stringContaining("symbolic link") }));
    expect(operation).not.toHaveBeenCalled();
    expect(await rawFs.readdir("/outside")).toEqual(["keep"]);
  });

  it("releases its own marker and directory after an operation error", async () => {
    const { fs, rawFs } = createFs();
    const failure = new Error("operation failed");
    await expect(withFileLock(fs, lockPath, async () => { throw failure; })).rejects.toBe(failure);
    await expect(rawFs.lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(withFileLock({ ...fs }, lockPath, async () => "next")).resolves.toBe("next");
  });

  it.each([
    { operationFails: false, target: "marker" },
    { operationFails: true, target: "marker" },
    { operationFails: false, target: "directory" },
    { operationFails: true, target: "directory" }
  ])("surfaces $target release errors (operation failed: $operationFails)", async ({ operationFails, target }) => {
    const { fs, rawFs } = createFs();
    const releaseFailure = Object.assign(new Error("release denied"), { code: "EACCES" });
    const operationFailure = new Error("operation failed");
    const failingFs = {
      ...fs,
      rmdir: vi.fn(async (directory: string) => {
        if (target === "marker" || directory === lockPath) throw releaseFailure;
        await rawFs.rmdir(directory);
      })
    };
    const result = withFileLock(failingFs, lockPath, async () => {
      if (operationFails) throw operationFailure;
      return "done";
    });
    if (operationFails) {
      await expect(result).rejects.toBeInstanceOf(AggregateError);
      await expect(result).rejects.toMatchObject({ errors: [operationFailure, releaseFailure] });
    } else await expect(result).rejects.toBe(releaseFailure);
    expect(failingFs.rmdir).toHaveBeenCalledTimes(target === "marker" ? 1 : 2);
    expect(await rawFs.readdir(lockPath)).toHaveLength(target === "marker" ? 1 : 0);
  });
});
