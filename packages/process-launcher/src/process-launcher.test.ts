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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("preserves the existing spec when updated spec persistence fails", async () => {
    const baseFs = createMemFs();
    const baseDir = "/state/launch";
    const originalSpec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    await writeRecord(
      baseFs,
      baseDir,
      originalSpec,
      createState(originalSpec, { status: "stopped" }),
      null
    );
    const fs: LauncherFileSystem = {
      ...baseFs,
      async writeFile(filePath, content, options) {
        if (filePath.includes("/spec.json")) {
          await baseFs.writeFile(filePath, "{", options);
          throw new Error("spec disk full");
        }
        await baseFs.writeFile(filePath, content, options);
      }
    };
    const spawnDaemon = vi.fn(async () => 321);

    await expect(
      startManagedProcess({
        baseDir,
        fs,
        spec: { ...originalSpec, command: "pnpm" },
        spawnDaemon
      })
    ).rejects.toThrow("spec disk full");

    await expect(fs.readFile(path.join(baseDir, "api", "spec.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(originalSpec)}\n`
    );
    const entries = await fs.readdir(path.join(baseDir, "api"));
    expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
    expect(spawnDaemon).not.toHaveBeenCalled();
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

  it("treats ESRCH while signaling a daemon as already stopped", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    let signalAttempted = false;
    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      expect(pid).toBe(654);
      expect(signal).toBe("SIGTERM");
      signalAttempted = true;
      throw createErrnoError("No such process", "ESRCH");
    });

    const result = await stopManagedProcess({
      baseDir,
      fs,
      id: "api",
      isPidRunning: (pid) => pid === 654 && !signalAttempted,
      pollIntervalMs: 1,
      signalProcess
    });

    expect(signalProcess).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      daemonPid: null,
      state: {
        pid: null,
        status: "stopped"
      }
    });
    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status": "stopped"');
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain('"daemonPid": null');
  });

  it("does not treat inherited ESRCH codes as missing process signals", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      expect(pid).toBe(654);
      expect(signal).toBe("SIGTERM");
      throw new Error("signal denied");
    });

    await withObjectPrototypeProperties({ code: "ESRCH" }, async () => {
      await expect(
        stopManagedProcess({
          baseDir,
          fs,
          id: "api",
          isPidRunning: (pid) => pid === 654,
          pollIntervalMs: 1,
          signalProcess
        })
      ).rejects.toThrow("signal denied");
    });

    expect(signalProcess).toHaveBeenCalledOnce();
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain(
      '"daemonPid":654'
    );
  });

  it("signals a live host child when its launcher daemon is stale", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    let childRunning = true;
    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      expect(pid).toBe(123);
      expect(signal).toBe("SIGTERM");
      childRunning = false;
    });

    const result = await stopManagedProcess({
      baseDir,
      fs,
      id: "api",
      isPidRunning: (pid) => pid === 123 && childRunning,
      pollIntervalMs: 1,
      signalProcess
    });

    expect(signalProcess).toHaveBeenCalledOnce();
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
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain('"daemonPid": null');
  });

  it("falls back to a live host child when the daemon exits during stop signaling", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = {
      id: "api",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure"
    };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);

    let daemonSignalAttempted = false;
    let childRunning = true;
    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      expect(signal).toBe("SIGTERM");
      if (pid === 654) {
        daemonSignalAttempted = true;
        throw createErrnoError("No such process", "ESRCH");
      }
      if (pid === 123) {
        childRunning = false;
        return;
      }
      throw new Error(`Unexpected pid ${pid}`);
    });

    const result = await stopManagedProcess({
      baseDir,
      fs,
      id: "api",
      isPidRunning: (pid) => {
        if (pid === 654) {
          return !daemonSignalAttempted;
        }
        if (pid === 123) {
          return childRunning;
        }
        return false;
      },
      pollIntervalMs: 1,
      signalProcess
    });

    expect(signalProcess).toHaveBeenCalledTimes(2);
    expect(signalProcess).toHaveBeenNthCalledWith(1, 654, "SIGTERM");
    expect(signalProcess).toHaveBeenNthCalledWith(2, 123, "SIGTERM");
    expect(result).toMatchObject({
      daemonPid: null,
      state: {
        pid: null,
        status: "stopped"
      }
    });
    await expect(fs.readFile(path.join(baseDir, "api", "state.json"), "utf8")).resolves.toContain('"status": "stopped"');
    await expect(fs.readFile(path.join(baseDir, "api", "meta.json"), "utf8")).resolves.toContain('"daemonPid": null');
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

  it("rejects invalid stop options before signaling", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 123, status: "running" }), 654);
    const signalProcess = vi.fn();

    await expect(
      stopManagedProcess({
        baseDir,
        fs,
        id: "api",
        signalProcess,
        stopTimeoutMs: -1
      })
    ).rejects.toThrow(/stop timeout/i);
    await expect(
      stopManagedProcess({
        baseDir,
        fs,
        id: "api",
        pollIntervalMs: Number.POSITIVE_INFINITY,
        signalProcess
      })
    ).rejects.toThrow(/poll interval/i);
    expect(signalProcess).not.toHaveBeenCalled();
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

  it("does not signal a stale host pid from an already stopped state", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: 4321, status: "stopped" }), null);
    const signalProcess = vi.fn();

    await expect(
      stopManagedProcess({ baseDir, fs, id: "api", isPidRunning: () => true, signalProcess })
    ).resolves.toMatchObject({ state: { status: "stopped" } });

    expect(signalProcess).not.toHaveBeenCalled();
  });

  it("terminates a spawned daemon if persisting its pid fails", async () => {
    const rawFs = createFsFromVolume(new Volume()).promises;
    const baseFs = createMemFsFromRaw(rawFs);
    let metaWrites = 0;
    const fs = {
      ...baseFs,
      writeFile: async (filePath: string, content: string, options) => {
        if (filePath.includes("/meta.json")) {
          metaWrites += 1;
          if (metaWrites === 2) {
            throw new Error("meta failed");
          }
        }
        await baseFs.writeFile(filePath, content, options);
      }
    } as LauncherFileSystem;
    const signalProcess = vi.fn();

    await expect(
      startManagedProcess({
        baseDir: "/state/launch",
        fs,
        signalProcess,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon: async () => 321
      })
    ).rejects.toThrow("meta failed");

    expect(signalProcess).toHaveBeenCalledWith(321, "SIGTERM");
    await expect(rawFs.readFile("/state/launch/api/state.json", "utf8")).resolves.toContain('"status": "stopped"');
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

  it("rejects invalid startup poll intervals before spawning a daemon", async () => {
    const fs = createMemFs();
    const spawnDaemon = vi.fn(async () => 321);

    await expect(
      startManagedProcess({
        baseDir: "/state/launch",
        fs,
        pollIntervalMs: Number.POSITIVE_INFINITY,
        spec: { id: "api", command: "npm", restart: "never" },
        spawnDaemon
      })
    ).rejects.toThrow(/poll interval/i);

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

  it("does not remove runtime artifacts before staging managed state removal succeeds", async () => {
    const rawFs = createFsFromVolume(new Volume()).promises;
    const baseFs = createMemFsFromRaw(rawFs);
    const fs = {
      ...baseFs,
      rename: async (sourcePath: string, destinationPath: string) => {
        if (sourcePath === `${baseDir}/api`) {
          throw new Error("state removal failed");
        }
        await baseFs.rename(sourcePath, destinationPath);
      }
    } as LauncherFileSystem;
    const baseDir = "/state/launch";
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never", docker: { image: "node:22" } };
    await writeRecord(fs, baseDir, spec, createState(spec, { pid: null, runtime: "docker", status: "stopped" }), null);
    const removeRuntimeArtifacts = vi.fn(async () => {});

    await expect(
      removeManagedProcess({ baseDir, fs, id: "api", removeRuntimeArtifacts })
    ).rejects.toThrow("state removal failed");

    expect(removeRuntimeArtifacts).not.toHaveBeenCalled();
  });

  it("rejects malformed persisted specification ids when listing", async () => {
    const fs = createMemFs();
    await fs.mkdir("/state/launch/alpha", { recursive: true });
    await fs.mkdir("/state/launch/zulu", { recursive: true });
    await fs.writeFile("/state/launch/alpha/spec.json", JSON.stringify({ id: "alpha", command: "npm", restart: "never" }));
    await fs.writeFile("/state/launch/zulu/spec.json", JSON.stringify({ id: 42, command: "npm", restart: "never" }));

    await expect(listManagedProcesses({ baseDir: "/state/launch", fs })).rejects.toThrow(/specification/i);
  });

  it("rejects malformed persisted specification shapes when listing", async () => {
    const fs = createMemFs();
    await fs.mkdir("/state/launch/api", { recursive: true });
    await fs.writeFile(
      "/state/launch/api/spec.json",
      JSON.stringify({ id: "api", command: 123, args: "bad", restart: "sometimes" })
    );
    await fs.writeFile(
      "/state/launch/api/state.json",
      JSON.stringify(createState({ id: "api", command: "npm", restart: "never" }, { status: "stopped" }))
    );

    await expect(listManagedProcesses({ baseDir: "/state/launch", fs })).rejects.toThrow(
      /specification/i
    );
  });

  it("rejects malformed persisted state when listing", async () => {
    const fs = createMemFs();
    await fs.mkdir("/state/launch/api", { recursive: true });
    await fs.writeFile(
      "/state/launch/api/spec.json",
      JSON.stringify({ id: "api", command: "npm", restart: "never" })
    );
    await fs.writeFile(
      "/state/launch/api/state.json",
      JSON.stringify({
        id: "api",
        pid: "not-a-number",
        status: "launching",
        runtime: "vm",
        restartCount: "many",
        lastExitCode: "zero",
        lastStartedAt: 123,
        lastStoppedAt: false,
        command: 42,
        args: "bad"
      })
    );

    await expect(listManagedProcesses({ baseDir: "/state/launch", fs })).rejects.toThrow(
      /state document/i
    );
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

  it("rejects starting through a symlinked launch root before persisting state", async () => {
    const volume = Volume.fromJSON({}, "/");
    volume.mkdirSync("/outside/launch", { recursive: true });
    volume.mkdirSync("/state", { recursive: true });
    volume.symlinkSync("/outside/launch", "/state/launch");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);
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
    await expect(rawFs.readFile("/outside/launch/api/spec.json", "utf8")).rejects.toThrow();
  });

  it("rejects listing through a symlinked launch root", async () => {
    const spec: ProcessSpec = { id: "api", command: "npm", restart: "never" };
    const volume = Volume.fromJSON({
      "/outside/launch/api/spec.json": `${JSON.stringify(spec)}\n`,
      "/outside/launch/api/state.json": `${JSON.stringify(createState(spec, { status: "stopped" }))}\n`,
      "/outside/launch/api/meta.json": `${JSON.stringify({ daemonPid: null })}\n`
    }, "/");
    volume.mkdirSync("/state", { recursive: true });
    volume.symlinkSync("/outside/launch", "/state/launch");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = createMemFsFromRaw(rawFs);

    await expect(listManagedProcesses({ baseDir: "/state/launch", fs })).rejects.toThrow(/symbolic link/i);
  });

  it("rejects run, log, and removal operations through a symlinked launch root", async () => {
    const spec: ProcessSpec = { id: "api", command: "__must_not_execute__", restart: "never" };
    const volume = Volume.fromJSON({
      "/outside/launch/api/logs/stdout.log": "external-log\n",
      "/outside/launch/api/spec.json": `${JSON.stringify(spec)}\n`,
      "/outside/launch/api/state.json": `${JSON.stringify(createState(spec, { status: "stopped" }))}\n`,
      "/outside/launch/api/meta.json": `${JSON.stringify({ daemonPid: null })}\n`
    }, "/");
    volume.mkdirSync("/state", { recursive: true });
    volume.symlinkSync("/outside/launch", "/state/launch");
    const rawFs = createFsFromVolume(volume).promises;
    const baseFs = createMemFsFromRaw(rawFs);
    const fs = {
      ...baseFs,
      writeFile: async (filePath: string, content: string) => {
        if (filePath.startsWith("/state/launch/")) {
          throw new Error("unexpected write through symlinked launch root");
        }
        await baseFs.writeFile(filePath, content);
      }
    } as LauncherFileSystem;

    await expect(readManagedLogs({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(runManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(removeManagedProcess({ baseDir: "/state/launch", fs, id: "api" })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/launch/api/logs/stdout.log", "utf8")).resolves.toBe("external-log\n");
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

  it("rejects invalid run poll intervals before writing daemon metadata", async () => {
    const fs = createMemFs();
    const baseDir = "/state/launch";
    await fs.mkdir(path.join(baseDir, "api"), { recursive: true });
    await fs.writeFile(
      path.join(baseDir, "api", "spec.json"),
      `${JSON.stringify({ id: "api", command: "node", args: ["-e", ""], restart: "never" })}\n`
    );

    await expect(
      runManagedProcess({
        baseDir,
        fs,
        id: "api",
        pollIntervalMs: Number.POSITIVE_INFINITY
      })
    ).rejects.toThrow(/poll interval/i);
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

  it("follows appended output from a byte cursor instead of rereading the log", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const baseFs = createMemFsFromRaw(rawFs);
    const logPath = "/state/launch/api/logs/stdout.log";
    const seedLog = `${Array.from({ length: 1_000 }, (_entry, index) => `line-${index}`).join("\n")}\n`;
    await baseFs.mkdir(path.dirname(logPath), { recursive: true });
    await baseFs.writeFile(logPath, seedLog);
    const wholeFileReads: string[] = [];
    const byteReads: Array<{ filePath: string; start: number }> = [];
    const fs: LauncherFileSystem = {
      ...baseFs,
      readFile: async (filePath, encoding) => {
        wholeFileReads.push(filePath);
        return await baseFs.readFile(filePath, encoding);
      },
      readFileBytes: async (filePath, start) => {
        byteReads.push({ filePath, start });
        const content = await rawFs.readFile(filePath) as Buffer;
        return content.subarray(start);
      }
    };
    const controller = new AbortController();
    const iterator = followManagedLogs({
      baseDir: "/state/launch",
      fs,
      id: "api",
      pollIntervalMs: 1,
      signal: controller.signal
    })[Symbol.asyncIterator]();

    const first = iterator.next();
    await new Promise(resolve => setTimeout(resolve, 2));
    await fs.appendFile(logPath, "first\n");
    await expect(first).resolves.toEqual({ done: false, value: "first" });

    const second = iterator.next();
    await new Promise(resolve => setTimeout(resolve, 2));
    await fs.appendFile(logPath, "second\n");
    await expect(second).resolves.toEqual({ done: false, value: "second" });

    const logReads = byteReads
      .filter(read => read.filePath === logPath)
      .map(read => read.start);
    expect(wholeFileReads.filter(filePath => filePath === logPath)).toEqual([]);
    expect(logReads).toContain(Buffer.byteLength(seedLog));
    expect(logReads).toContain(Buffer.byteLength(`${seedLog}first\n`));

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
    readFileBytes: async (filePath, start) => {
      const content = await rawFs.readFile(filePath) as Buffer;
      return content.subarray(start);
    },
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
        dev: Number(stat.dev),
        ino: Number(stat.ino),
        isFile: () => stat.isFile(),
        mtimeMs: Number(stat.mtimeMs),
        size: Number(stat.size)
      };
    },
    lstat: async filePath => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    writeFile: async (filePath, content, options) => {
      await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
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

function createErrnoError(message: string, code: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
