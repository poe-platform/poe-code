import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { Runner } from "@poe-code/process-runner";
import * as api from "@poe-code/process-launcher";
import {
  createLogWriter,
  createStateStore,
  createSupervisor,
  listManagedProcesses,
  readManagedLogs,
  removeManagedProcess,
  restartManagedProcess,
  runManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  followManagedLogs,
  waitForReady,
  type LauncherFileSystem,
  type LogWriter,
  type ProcessSpec,
  type ProcessState,
  type ProcessStatus,
  type ReadyCheck,
  type RestartPolicy,
  type StateStore,
  type Supervisor,
  type SupervisorOptions
} from "@poe-code/process-launcher";

describe("@poe-code/process-launcher public exports", () => {
  it("exports SDK helpers and types", () => {
    const restart: RestartPolicy = "always";
    const readyCheck: ReadyCheck = { kind: "tcp", port: 3000, host: "127.0.0.1", timeoutMs: 500 };
    const status: ProcessStatus = "stopped";
    const hostSpec: ProcessSpec = {
      id: "host-service",
      command: "npm",
      args: ["run", "dev"],
      restart: "never"
    };
    const spec: ProcessSpec = {
      id: "service",
      command: "npm",
      args: ["run", "dev"],
      readyCheck,
      restart,
      maxRestarts: 3,
      backoffMs: 250,
      maxBackoffMs: 1_000,
      logRetainCount: 5,
      docker: {
        image: "node:22",
        containerName: "service-test"
      }
    };
    const state: ProcessState = {
      id: spec.id,
      pid: null,
      status,
      runtime: "host",
      restartCount: 0,
      lastExitCode: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      command: spec.command,
      args: spec.args ?? []
    };
    const fs = null as unknown as LauncherFileSystem;
    const supervisor = null as unknown as Supervisor;
    const stateStore = null as unknown as StateStore;
    const logWriter = null as unknown as LogWriter;
    const runner = null as unknown as Runner;
    const signal = new AbortController().signal;
    const options: SupervisorOptions = {
      spec,
      stateDir: "/tmp/poe-code",
      runner,
      signal,
      onLog() {},
      onStatusChange() {}
    };

    expect(typeof createSupervisor).toBe("function");
    expect(typeof createStateStore).toBe("function");
    expect(typeof createLogWriter).toBe("function");
    expect(typeof waitForReady).toBe("function");
    expect(options.spec.readyCheck).toEqual(readyCheck);
    expect(options.runner).toBe(runner);
    expect(hostSpec.docker).toBeUndefined();
    expect(spec.docker?.containerName).toBe("service-test");

    void fs;
    void supervisor;
    void stateStore;
    void logWriter;
    void state;
  });

  it("keeps type-only exports out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("ProcessSpec");
    expect(api).not.toHaveProperty("SupervisorOptions");
    expect(api).not.toHaveProperty("StateStore");
    expect(api.createStateStore).toBe(createStateStore);
    expect(api.createLogWriter).toBe(createLogWriter);
    expect(api.waitForReady).toBe(waitForReady);
    expect(api.createSupervisor).toBe(createSupervisor);
    expect(api.followManagedLogs).toBe(followManagedLogs);
    expect(api.listManagedProcesses).toBe(listManagedProcesses);
    expect(api.readManagedLogs).toBe(readManagedLogs);
    expect(api.removeManagedProcess).toBe(removeManagedProcess);
    expect(api.restartManagedProcess).toBe(restartManagedProcess);
    expect(api.runManagedProcess).toBe(runManagedProcess);
    expect(api.startManagedProcess).toBe(startManagedProcess);
    expect(api.stopManagedProcess).toBe(stopManagedProcess);
    expect(Object.keys(api)).toEqual([
      "createStateStore",
      "createLogWriter",
      "waitForReady",
      "createSupervisor",
      "followManagedLogs",
      "listManagedProcesses",
      "readManagedLogs",
      "removeManagedProcess",
      "restartManagedProcess",
      "runManagedProcess",
      "startManagedProcess",
      "stopManagedProcess"
    ]);
  });
});

describe("process launcher manager", () => {
  it("starts a managed process, persists spec, and returns the running record", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };

    const recordPromise = startManagedProcess({
      baseDir,
      fs,
      pollIntervalMs: 1,
      spec,
      isPidRunning: (pid) => pid === 321,
      spawnDaemon: async (id) => {
        await fs.mkdir(path.join(baseDir, id), { recursive: true });
        await fs.writeFile(
          path.join(baseDir, id, "state.json"),
          `${JSON.stringify(createState(spec, { pid: 123, status: "running" }))}\n`
        );
        return 321;
      }
    });

    await expect(recordPromise).resolves.toMatchObject({
      daemonPid: 321,
      spec: {
        command: "npm",
        id: "api",
        restart: "on-failure"
      },
      state: {
        pid: 123,
        status: "running"
      }
    });

    const specContent = await fs.readFile(path.join(baseDir, "api", "spec.json"), "utf8");
    const persistedSpec = JSON.parse(specContent) as ProcessSpec;
    expect(persistedSpec).toMatchObject({
      command: "npm",
      id: "api",
      restart: "on-failure"
    });

    const metaContent = await fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8");
    expect(JSON.parse(metaContent)).toMatchObject({ daemonPid: 321 });
  });

  it("persists stopped state when daemon spawning rejects", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";

    await expect(
      startManagedProcess({
        baseDir,
        fs,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon: async () => {
          throw new Error("spawn denied");
        }
      })
    ).rejects.toThrow("spawn denied");

    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status": "stopped"');
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain('"daemonPid": null');
  });

  it("rejects a start without a daemon and persists its stopped state", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";

    await expect(
      startManagedProcess({
        baseDir,
        fs,
        pollIntervalMs: 1,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon: async () => null
      })
    ).rejects.toThrow(/failed to start/i);

    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status": "stopped"');
  });

  it("rejects a process that crashes during startup", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };

    await expect(
      startManagedProcess({
        baseDir,
        fs,
        pollIntervalMs: 1,
        spec,
        spawnDaemon: async () => {
          await fs.writeFile(
            path.join(baseDir, "api", "state.json"),
            `${JSON.stringify(createState(spec, { lastExitCode: 1, pid: null, status: "crashed" }))}\n`
          );
          return null;
        }
      })
    ).rejects.toThrow(/failed to start/i);

    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status": "crashed"');
  });

  it("stops a daemon and persists stopped state when startup times out", async () => {
    const fs = createMemFs();
    let running = true;
    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      expect(pid).toBe(321);
      expect(signal).toBe("SIGTERM");
      running = false;
    });

    await expect(
      startManagedProcess({
        baseDir: "/state/launch",
        fs,
        isPidRunning: () => running,
        pollIntervalMs: 1,
        signalProcess,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon: async () => 321,
        startupTimeoutMs: 1
      })
    ).rejects.toThrow(/timed out/i);

    expect(signalProcess).toHaveBeenCalledOnce();
    await expect(fs.readFile("/state/launch/api/state.json", "utf8")).resolves.toContain('"status": "stopped"');
    await expect(fs.readFile("/state/launch/api/meta.json", "utf8")).resolves.toContain('"daemonPid": null');
  });

  it("stops a stale running process and updates the persisted state", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    let running = true;
    const result = await stopManagedProcess({
      baseDir,
      fs,
      pollIntervalMs: 1,
      isPidRunning: (pid) => pid === 654 && running,
      signalProcess: (pid, signal) => {
        expect(pid).toBe(654);
        expect(signal).toBe("SIGTERM");
        running = false;
      },
      id: "api"
    });

    expect(result).toMatchObject({
      daemonPid: null,
      state: {
        pid: null,
        status: "stopped"
      }
    });

    const stateContent = await fs.readFile(path.join(baseDir, "api", "state.json"), "utf8");
    expect(JSON.parse(stateContent)).toMatchObject({
      pid: null,
      status: "stopped"
    });
  });

  it("rejects a stop timeout without clearing a running daemon", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    await expect(
      stopManagedProcess({
        baseDir,
        fs,
        id: "api",
        isPidRunning: () => true,
        pollIntervalMs: 1,
        signalProcess: vi.fn(),
        stopTimeoutMs: 1
      })
    ).rejects.toThrow(/timed out/i);

    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status":"running"');
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain('"daemonPid":654');
  });

  it("rejects malformed persisted daemon metadata before signaling", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    await writeRecord(fs, baseDir, spec, createState(spec, { status: "running" }), null);
    await fs.writeFile(path.join(baseDir, "api", "meta.json"), `${JSON.stringify({ daemonPid: "bad" })}\n`);
    const signalProcess = vi.fn();

    await expect(
      stopManagedProcess({ baseDir, fs, id: "api", signalProcess })
    ).rejects.toThrow(/metadata/i);

    expect(signalProcess).not.toHaveBeenCalled();
  });

  it("rejects non-finite startup timeout before spawning a daemon", async () => {
    const fs = createMemFs();
    const spawnDaemon = vi.fn(async () => 321);

    await expect(
      startManagedProcess({
        baseDir: "/state/launch",
        fs,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon,
        startupTimeoutMs: Number.NaN
      })
    ).rejects.toThrow(/startup timeout/i);

    expect(spawnDaemon).not.toHaveBeenCalled();
    await expect(fs.readdir("/state/launch")).rejects.toThrow();
  });

  it("lists managed processes with stale daemon processes marked as stopped", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 999);

    const records = await listManagedProcesses({
      baseDir,
      fs,
      isPidRunning: () => false
    });

    expect(records).toEqual([
      expect.objectContaining({
        daemonPid: null,
        state: expect.objectContaining({
          pid: null,
          status: "stopped"
        })
      })
    ]);
  });

  it("tails logs and removes stopped processes", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      restart: "never"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: null, status: "stopped" }), null);
    await fs.mkdir(path.join(baseDir, "api", "logs"), { recursive: true });
    await fs.writeFile(
      path.join(baseDir, "api", "logs", "stdout.log"),
      ["one", "two", "three", "four"].join("\n") + "\n"
    );

    await expect(
      readManagedLogs({ baseDir, fs, id: "api", lines: 2, stream: "stdout" })
    ).resolves.toEqual(["three", "four"]);

    const removeRuntimeArtifacts = vi.fn(async () => {});
    await removeManagedProcess({
      baseDir,
      fs,
      id: "api",
      removeRuntimeArtifacts
    });

    expect(removeRuntimeArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          spec: expect.objectContaining({ id: "api" })
        })
      })
    );
    await expect(fs.readdir(baseDir)).resolves.toEqual([]);
  });

  it("rejects malformed persisted specification ids when listing", async () => {
    const fs = createMemFs();
    await fs.mkdir("/state/launch/alpha", { recursive: true });
    await fs.mkdir("/state/launch/zulu", { recursive: true });
    await fs.writeFile("/state/launch/alpha/spec.json", JSON.stringify({ id: "alpha", command: "npm", restart: "never" }));
    await fs.writeFile("/state/launch/zulu/spec.json", JSON.stringify({ id: 42, command: "npm", restart: "never" }));

    await expect(listManagedProcesses({ baseDir: "/state/launch", fs })).rejects.toThrow(/specification/i);
  });

  it("rejects restarting a record whose persisted id redirects the launch", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "redirected", command: "npm", restart: "never" };
    await fs.mkdir(path.join(baseDir, "requested"), { recursive: true });
    await fs.writeFile(path.join(baseDir, "requested", "spec.json"), `${JSON.stringify(spec)}\n`);
    await fs.writeFile(
      path.join(baseDir, "requested", "state.json"),
      `${JSON.stringify(createState({ ...spec, id: "requested" }, { status: "stopped" }))}\n`
    );
    await fs.writeFile(path.join(baseDir, "requested", "meta.json"), `${JSON.stringify({ daemonPid: null })}\n`);
    const spawnDaemon = vi.fn(async () => null);

    await expect(
      restartManagedProcess({ baseDir, fs, id: "requested", spawnDaemon })
    ).rejects.toThrow(/specification/i);

    expect(spawnDaemon).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(baseDir, "redirected", "state.json"), "utf8")).rejects.toThrow();
  });

  it("rejects path traversal ids for managed process operations", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "../victim", command: "npm", restart: "never" };

    await expect(readManagedLogs({ baseDir, fs, id: "../victim" })).rejects.toThrow(/process id/i);
    await expect(removeManagedProcess({ baseDir, fs, id: "../victim" })).rejects.toThrow(/process id/i);
    await expect(runManagedProcess({ baseDir, fs, id: "../victim" })).rejects.toThrow(/process id/i);
    await expect(restartManagedProcess({ baseDir, fs, id: "../victim", spawnDaemon: async () => null })).rejects.toThrow(/process id/i);
    await expect(startManagedProcess({ baseDir, fs, spec, spawnDaemon: async () => null })).rejects.toThrow(/process id/i);
  });

  it("rejects a symlinked managed process directory", async () => {
    const volume = Volume.fromJSON({
      "/outside/logs/stdout.log": "external-log\n",
      "/outside/spec.json": JSON.stringify({ id: "api", command: "npm", restart: "never" })
    }, "/");
    volume.mkdirSync("/state/launch", { recursive: true });
    volume.symlinkSync("/outside", "/state/launch/api");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);

    await expect(readManagedLogs({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(removeManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(runManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    const spawnDaemon = vi.fn(async () => null);
    await expect(
      startManagedProcess({
        baseDir: "/state/launch",
        fs,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon
      })
    ).rejects.toThrow(/symbolic link/i);
    expect(spawnDaemon).not.toHaveBeenCalled();
    await expect(rawFs.readFile("/outside/logs/stdout.log", "utf8")).resolves.toBe("external-log\n");
  });

  it("rejects a symlinked managed log directory", async () => {
    const volume = Volume.fromJSON({
      "/state/launch/api/spec.json": JSON.stringify({ id: "api", command: "npm", restart: "never" }),
      "/outside/stdout.log": "external-log\n"
    }, "/");
    volume.symlinkSync("/outside", "/state/launch/api/logs");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);

    await expect(readManagedLogs({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(runManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/stdout.log", "utf8")).resolves.toBe("external-log\n");
  });

  it("rejects symlinked managed specification and metadata files", async () => {
    const volume = Volume.fromJSON({
      "/outside/spec.json": JSON.stringify({ id: "api", command: "npm", restart: "never" }),
      "/outside/meta.json": "external-meta\n"
    }, "/");
    volume.mkdirSync("/state/launch/api", { recursive: true });
    volume.symlinkSync("/outside/spec.json", "/state/launch/api/spec.json");
    volume.symlinkSync("/outside/meta.json", "/state/launch/api/meta.json");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);

    await expect(runManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/meta.json", "utf8")).resolves.toBe("external-meta\n");
  });

  it("rejects symlinked child directories during managed removal", async () => {
    const volume = Volume.fromJSON({
      "/state/launch/api/spec.json": JSON.stringify({ id: "api", command: "npm", restart: "never" }),
      "/outside/victim.txt": "keep-me\n"
    }, "/");
    volume.symlinkSync("/outside", "/state/launch/api/artifacts");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);

    await expect(removeManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/victim.txt", "utf8")).resolves.toBe("keep-me\n");
  });

  it("does not run a managed process when its signal is already aborted", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    await fs.mkdir(path.join(baseDir, "api"), { recursive: true });
    await fs.writeFile(
      path.join(baseDir, "api", "spec.json"),
      `${JSON.stringify({ id: "api", command: "__must_not_execute__", restart: "never" })}\n`
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      runManagedProcess({ baseDir, fs, id: "api", signal: controller.signal })
    ).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).rejects.toThrow();
  });

  it("follows appended output after a bounded initial log window", async () => {
    const fs = createMemFs();
    const logPath = "/state/launch/api/logs/stdout.log";
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, "one\ntwo\n");
    const controller = new AbortController();
    const iterator = followManagedLogs({
      baseDir: "/state/launch",
      fs,
      id: "api",
      lines: 2,
      pollIntervalMs: 1,
      signal: controller.signal
    })[Symbol.asyncIterator]();

    const next = iterator.next();
    await new Promise(resolve => setTimeout(resolve, 2));
    await fs.appendFile(logPath, "three\n");

    await expect(next).resolves.toEqual({ done: false, value: "three" });
    controller.abort();
    await iterator.return?.();
  });

  it("follows fresh output after current log rotation", async () => {
    const fs = createMemFs();
    const logDir = "/state/launch/api/logs";
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(logDir, "stdout.log"), "old-one\nold-two\n");
    const controller = new AbortController();
    const iterator = followManagedLogs({
      baseDir: "/state/launch",
      fs,
      id: "api",
      pollIntervalMs: 1,
      signal: controller.signal
    })[Symbol.asyncIterator]();

    const next = iterator.next();
    await new Promise(resolve => setTimeout(resolve, 2));
    await fs.writeFile(path.join(logDir, "stdout.log"), "new-one\n");

    await expect(next).resolves.toEqual({ done: false, value: "new-one" });
    controller.abort();
    await iterator.return?.();
  });

  it("rejects an infinite follow polling interval", async () => {
    const iterator = followManagedLogs({
      baseDir: "/state/launch",
      fs: createMemFs(),
      id: "api",
      pollIntervalMs: Number.POSITIVE_INFINITY
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(/poll interval/i);
  });
});

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  const rawFs = createFsFromVolume(volume).promises;

  return createMemFsFromRaw(rawFs);
}

function createMemFsFromRaw(rawFs: ReturnType<typeof createFsFromVolume>["promises"]): LauncherFileSystem {

  return {
    appendFile: async (filePath, content) => {
      await rawFs.appendFile(filePath, content, { encoding: "utf8" });
    },
    mkdir: async (filePath, options) => {
      await rawFs.mkdir(filePath, options);
    },
    readFile: async (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    readdir: async filePath => rawFs.readdir(filePath) as Promise<string[]>,
    rm: async (filePath, options) => {
      await rawFs.rm(filePath, options);
    },
    rename: async (sourcePath, destinationPath) => {
      await rawFs.rename(sourcePath, destinationPath);
    },
    stat: async filePath => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    lstat: async filePath => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    writeFile: async (filePath, content) => {
      await rawFs.writeFile(filePath, content, { encoding: "utf8" });
    },
    rmdir: async (filePath) => {
      await rawFs.rmdir(filePath);
    }
  } as LauncherFileSystem;
}

async function writeRecord(
  fs: LauncherFileSystem,
  baseDir: string,
  spec: ProcessSpec,
  state: ProcessState,
  daemonPid: number | null
): Promise<void> {
  const processDir = path.join(baseDir, spec.id);
  await fs.mkdir(path.join(processDir, "logs"), { recursive: true });
  await fs.writeFile(path.join(processDir, "spec.json"), `${JSON.stringify(spec)}\n`);
  await fs.writeFile(path.join(processDir, "state.json"), `${JSON.stringify(state)}\n`);
  await fs.writeFile(path.join(processDir, "meta.json"), `${JSON.stringify({ daemonPid })}\n`);
}

function createState(
  spec: ProcessSpec,
  overrides: Partial<ProcessState>
): ProcessState {
  return {
    id: spec.id,
    pid: null,
    status: "stopped",
    runtime: spec.docker ? "docker" : "host",
    restartCount: 0,
    lastExitCode: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    command: spec.command,
    args: [...(spec.args ?? [])],
    ...overrides
  };
}
