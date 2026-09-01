import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import {
  createStateStore,
  listManagedProcesses,
  removeManagedProcess,
  restartManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  type LauncherFileSystem,
  type ProcessSpec
} from "@poe-code/process-launcher";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createFixture(baseDir = "/launch", volume = new Volume()) {
  const fs = createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
  const spec: ProcessSpec = { id: "worker", command: "fake-worker", restart: "never" };
  const entered = deferred();
  const release = deferred();
  const running = new Set<number>();
  let nextPid = 100;
  const spawnDaemon = vi.fn(async (id: string) => {
    const daemonPid = ++nextPid;
    running.add(daemonPid);
    if (daemonPid === 101) {
      entered.resolve();
      await release.promise;
    }
    const childPid = daemonPid + 1000;
    running.add(childPid);
    await createStateStore(baseDir, fs).write(id, {
      id,
      command: spec.command,
      args: [],
      pid: childPid,
      status: "running",
      runtime: "host",
      restartCount: 0,
      lastExitCode: null,
      lastStartedAt: new Date().toISOString(),
      lastStoppedAt: null
    });
    return daemonPid;
  });
  const signalProcess = vi.fn((pid: number) => {
    running.delete(pid);
    running.delete(pid + 1000);
  });
  const common = {
    baseDir,
    fs,
    isPidRunning: (pid: number) => running.has(pid),
    pollIntervalMs: 0,
    signalProcess,
    spawnDaemon,
    startupTimeoutMs: 100,
    stopTimeoutMs: 100
  };
  const start = (overrides: Partial<typeof common> & { spec?: ProcessSpec } = {}) =>
    startManagedProcess({ ...common, spec, ...overrides });
  return { volume, common, spec, entered, release, running, spawnDaemon, signalProcess, start };
}

describe("managed process lifecycle ownership", () => {
  it("keeps contention and manual recovery guidance on separate readable lines", async () => {
    const fixture = createFixture();
    const first = fixture.start();
    try {
      await fixture.entered.promise;
      const error = await fixture.start().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      const lines = (error as Error).message.split("\n");
      expect(lines[0]).toBe('Managed process "worker" has another operation in progress.');
      expect(lines).toContain("Retry after it finishes.");
      expect(lines.at(-1)).toBe("/launch/.operation-worker.lock");
    } finally {
      fixture.release.resolve();
      await first;
    }
  });

  it("rejects a second start during daemon registration and stops the only process group", async () => {
    const fixture = createFixture();
    const first = fixture.start();
    try {
      await fixture.entered.promise;
      const independentFs = createFsFromVolume(fixture.volume).promises as unknown as LauncherFileSystem;
      await expect(fixture.start({ fs: independentFs })).rejects.toThrow("operation in progress");
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(1);
      fixture.release.resolve();
      await expect(first).resolves.toMatchObject({ daemonPid: 101, state: { pid: 1101, status: "running" } });
      await expect(listManagedProcesses(fixture.common)).resolves.toMatchObject([
        { daemonPid: 101, state: { pid: 1101, status: "running" } }
      ]);
      await expect(fixture.start()).rejects.toThrow("already running");
      await expect(stopManagedProcess({ ...fixture.common, id: fixture.spec.id })).resolves.toMatchObject({
        daemonPid: null,
        state: { pid: null, status: "stopped" }
      });
      expect(fixture.signalProcess.mock.calls).toEqual([[101, "SIGTERM"]]);
      expect(fixture.running.size).toBe(0);
      await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 102 });
    } finally {
      fixture.release.resolve();
      await first.catch(() => undefined);
    }
  });

  it("reserves the name before either simultaneous caller can inspect its state", async () => {
    const fixture = createFixture();
    const first = fixture.start();
    const second = fixture.start().then(
      (record) => ({ record, error: null }),
      (error: unknown) => ({ record: null, error })
    );
    try {
      await fixture.entered.promise;
      const outcome = await second;
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toContain("operation in progress");
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(1);
    } finally {
      fixture.release.resolve();
      await first.catch(() => undefined);
      await second;
    }
  });

  it.each(["stop", "remove", "restart"] as const)("does not let %s overwrite an unfinished start", async (operation) => {
    const fixture = createFixture();
    const first = fixture.start();
    try {
      await fixture.entered.promise;
      const options = { ...fixture.common, id: fixture.spec.id };
      const competing = operation === "stop"
        ? stopManagedProcess(options)
        : operation === "remove"
          ? removeManagedProcess(options)
          : restartManagedProcess(options);
      await expect(competing).rejects.toThrow("operation in progress");
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(1);
      expect(fixture.signalProcess).not.toHaveBeenCalled();
      fixture.release.resolve();
      await expect(first).resolves.toMatchObject({ spec: fixture.spec, daemonPid: 101 });
    } finally {
      fixture.release.resolve();
      await first.catch(() => undefined);
    }
  });

  it("allows a different name to start while the first name is reserved", async () => {
    const fixture = createFixture();
    const first = fixture.start();
    try {
      await fixture.entered.promise;
      await expect(fixture.start({ spec: { ...fixture.spec, id: "other" } })).resolves.toMatchObject({
        daemonPid: 102,
        spec: { id: "other" }
      });
    } finally {
      fixture.release.resolve();
      await first;
    }
  });

  it("releases startup ownership after a rejected spawn so a retry can succeed", async () => {
    const fixture = createFixture();
    const failure = new Error("daemon spawn failed");
    await expect(fixture.start({ spawnDaemon: async () => { throw failure; } })).rejects.toBe(failure);
    fixture.release.resolve();
    await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 101 });
  });

  it("releases startup ownership when bootstrap persistence fails before spawning", async () => {
    const fixture = createFixture();
    const failure = new Error("state write failed");
    const fs: LauncherFileSystem = {
      ...fixture.common.fs,
      async writeFile(filePath, content, options) {
        if (filePath.includes("/state.json.")) throw failure;
        await fixture.common.fs.writeFile(filePath, content, options);
      }
    };
    await expect(fixture.start({ fs })).rejects.toBe(failure);
    expect(fixture.spawnDaemon).not.toHaveBeenCalled();
    fixture.release.resolve();
    await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 101 });
  });

  it("retains ownership throughout failed-start cleanup", async () => {
    const fixture = createFixture();
    const cleaning = deferred();
    const releaseCleanup = deferred();
    let cleanupPaused = false;
    const fs: LauncherFileSystem = {
      ...fixture.common.fs,
      async readFile(filePath, encoding) {
        if (cleanupPaused && filePath.endsWith("/spec.json")) {
          cleaning.resolve();
          await releaseCleanup.promise;
        }
        return await fixture.common.fs.readFile(filePath, encoding);
      }
    };
    const failure = new Error("spawn failed");
    const first = fixture.start({ fs, spawnDaemon: async () => { cleanupPaused = true; throw failure; } });
    const failed = expect(first).rejects.toBe(failure);
    try {
      await cleaning.promise;
      fixture.release.resolve();
      await expect(fixture.start()).rejects.toThrow("operation in progress");
      expect(fixture.spawnDaemon).not.toHaveBeenCalled();
    } finally {
      releaseCleanup.resolve();
      await failed;
    }
    await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 101 });
  });

  it("keeps identical names independent across state directories", async () => {
    const firstFixture = createFixture();
    const secondFixture = createFixture("/other-launch", firstFixture.volume);
    const first = firstFixture.start();
    try {
      await firstFixture.entered.promise;
      secondFixture.release.resolve();
      await expect(secondFixture.start()).resolves.toMatchObject({ daemonPid: 101 });
    } finally {
      firstFixture.release.resolve();
      await first;
    }
  });

  it("uses filesystem ownership even when callers spell the same base directory differently", async () => {
    const fixture = createFixture();
    const first = fixture.start();
    try {
      await fixture.entered.promise;
      await expect(fixture.start({ baseDir: "/launch/../launch" })).rejects.toThrow("operation in progress");
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(1);
    } finally {
      fixture.release.resolve();
      await first;
    }
  });

  it.each(["stop", "restart"] as const)("keeps %s ownership while the stopped state is being observed", async (operation) => {
    const fixture = createFixture();
    fixture.release.resolve();
    await fixture.start();
    const observing = deferred();
    const releaseObservation = deferred();
    let signalled = false;
    const options = {
      ...fixture.common,
      id: fixture.spec.id,
      signalProcess(pid: number) {
        fixture.signalProcess(pid);
        signalled = true;
      },
      fs: {
        ...fixture.common.fs,
        async readFile(filePath: string, encoding: BufferEncoding) {
          if (signalled && filePath.endsWith("/spec.json")) {
            observing.resolve();
            await releaseObservation.promise;
          }
          return await fixture.common.fs.readFile(filePath, encoding);
        }
      }
    };
    const pending = operation === "stop" ? stopManagedProcess(options) : restartManagedProcess(options);
    try {
      await observing.promise;
      await expect(fixture.start()).rejects.toThrow("operation in progress");
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(1);
    } finally {
      releaseObservation.resolve();
      await pending;
    }
    if (operation === "restart") {
      expect(fixture.spawnDaemon).toHaveBeenCalledTimes(2);
      expect(fixture.running).toEqual(new Set([102, 1102]));
    } else {
      expect(fixture.running.size).toBe(0);
      await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 102 });
    }
  });

  it("holds ownership outside the removed directory until runtime cleanup finishes", async () => {
    const fixture = createFixture();
    fixture.release.resolve();
    await fixture.start();
    await stopManagedProcess({ ...fixture.common, id: fixture.spec.id });
    const cleaning = deferred();
    const releaseCleanup = deferred();
    const removing = removeManagedProcess({
      ...fixture.common,
      id: fixture.spec.id,
      removeRuntimeArtifacts: async () => {
        cleaning.resolve();
        await releaseCleanup.promise;
      }
    });
    try {
      await cleaning.promise;
      await expect(listManagedProcesses(fixture.common)).resolves.toEqual([]);
      await expect(fixture.start()).rejects.toThrow("operation in progress");
    } finally {
      releaseCleanup.resolve();
      await removing;
    }
    await expect(fixture.start()).resolves.toMatchObject({ daemonPid: 102 });
  });

  it("preserves both the operation failure and a failed ownership release", async () => {
    const fixture = createFixture();
    const spawnFailure = new Error("spawn rejected");
    const releaseFailure = new Error("reservation removal failed");
    const fs: LauncherFileSystem = {
      ...fixture.common.fs,
      async rm(filePath, options) {
        if (filePath.endsWith(".lock")) throw releaseFailure;
        await fixture.common.fs.rm(filePath, options);
      }
    };
    await expect(fixture.start({ fs, spawnDaemon: async () => { throw spawnFailure; } })).rejects.toMatchObject({
      errors: [spawnFailure, releaseFailure]
    });
    await expect(fixture.start()).rejects.toThrow("/launch/.operation-worker.lock");
    expect(fixture.spawnDaemon).not.toHaveBeenCalled();
  });

  it("does not delete a reservation whose owner token changed before release", async () => {
    const fixture = createFixture();
    const lockPath = "/launch/.operation-worker.lock";
    const replacement = JSON.stringify({ token: "replacement", pid: 123 });
    await expect(fixture.start({
      spawnDaemon: async () => {
        await fixture.common.fs.writeFile(lockPath, replacement);
        throw new Error("first caller failed");
      }
    })).rejects.toMatchObject({
      errors: [expect.any(Error), expect.objectContaining({ message: expect.stringContaining("ownership changed") })]
    });
    await expect(fixture.common.fs.readFile(lockPath, "utf8")).resolves.toBe(replacement);
    await expect(fixture.start()).rejects.toThrow("operation in progress");
  });
});
