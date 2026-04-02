import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { LauncherFileSystem, ProcessSpec, ProcessState } from "./types.js";
import {
  listManagedProcesses,
  readManagedLogs,
  removeManagedProcess,
  startManagedProcess,
  stopManagedProcess
} from "./launcher.js";

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
});

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  const rawFs = createFsFromVolume(volume).promises;

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
    stat: async filePath => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: Number(stat.mtimeMs)
      };
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
