import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { createStateStore } from "./state-store.js";
import type { LauncherFileSystem, ProcessState } from "../types.js";

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

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
}

function createProcessState(id: string, overrides: Partial<ProcessState> = {}): ProcessState {
  return {
    id,
    pid: 1234,
    status: "running",
    runtime: "host",
    restartCount: 0,
    lastExitCode: null,
    lastStartedAt: "2026-04-02T12:00:00.000Z",
    lastStoppedAt: null,
    command: "npm",
    args: ["run", "dev"],
    ...overrides
  };
}

describe("createStateStore", () => {
  it("write() creates directory and state.json", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const state = createProcessState("alpha");

    await store.write(state.id, state);

    await expect(fs.readFile(path.join(stateDir, state.id, "state.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(state, null, 2)}\n`
    );
  });

  it("read() returns written state", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const state = createProcessState("alpha");

    await store.write(state.id, state);

    await expect(store.read(state.id)).resolves.toEqual(state);
  });

  it("rejects persisted null process state documents", async () => {
    const fs = createMemFs();
    const store = createStateStore("/state", fs);
    await fs.mkdir("/state/alpha", { recursive: true });
    await fs.writeFile("/state/alpha/state.json", "null\n");

    await expect(store.read("alpha")).rejects.toThrow("Invalid process state document: alpha");
    await expect(store.list()).rejects.toThrow("Invalid process state document: alpha");
  });

  it("read() returns null for non-existent id", async () => {
    const store = createStateStore("/state", createMemFs());

    await expect(store.read("missing")).resolves.toBeNull();
  });

  it("list() returns all written states", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const alpha = createProcessState("alpha");
    const beta = createProcessState("beta", {
      pid: 5678,
      status: "stopped",
      lastStoppedAt: "2026-04-02T13:00:00.000Z"
    });

    await store.write(alpha.id, alpha);
    await store.write(beta.id, beta);

    await expect(store.list()).resolves.toEqual([alpha, beta]);
  });

  it("list() returns empty array when stateDir is empty", async () => {
    const fs = createMemFs();
    await fs.mkdir("/state", { recursive: true });
    const store = createStateStore("/state", fs);

    await expect(store.list()).resolves.toEqual([]);
  });

  it("does not treat inherited not-found codes as missing state directories", async () => {
    const baseFs = createMemFs();
    const fs = {
      ...baseFs,
      readdir: async (directoryPath: string) => {
        if (directoryPath === "/state") {
          throw new Error("state directory read denied");
        }

        return await baseFs.readdir(directoryPath);
      }
    } as LauncherFileSystem;

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(createStateStore("/state", fs).list()).rejects.toThrow(
        "state directory read denied"
      );
    });
  });

  it("list() skips directories without state.json", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const state = createProcessState("alpha");

    await store.write(state.id, state);
    await fs.mkdir(path.join(stateDir, "orphan"), { recursive: true });

    await expect(store.list()).resolves.toEqual([state]);
  });

  it("list() works when destructured from the store", async () => {
    const fs = createMemFs();
    const store = createStateStore("/state", fs);
    const state = createProcessState("alpha");

    await store.write(state.id, state);

    const { list } = store;

    await expect(list()).resolves.toEqual([state]);
  });

  it("remove() deletes the process directory", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const state = createProcessState("alpha");

    await store.write(state.id, state);
    await store.remove(state.id);

    await expect(
      fs.readFile(path.join(stateDir, state.id, "state.json"), "utf8")
    ).rejects.toThrow();
    await expect(store.read(state.id)).resolves.toBeNull();
  });

  it("remove() deletes nested log files recursively", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const state = createProcessState("alpha");
    const logsDir = path.join(stateDir, state.id, "logs");

    await store.write(state.id, state);
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "stdout.log"), "hello\n");
    await fs.writeFile(path.join(logsDir, "stderr.1.log"), "oops\n");

    await store.remove(state.id);

    await expect(fs.readdir(path.join(stateDir, state.id))).rejects.toThrow();
  });

  it("remove() commits state removal before best-effort directory cleanup", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const stateDir = "/state";
    const processDir = path.join(stateDir, "alpha");
    const base = rawFs as unknown as LauncherFileSystem;
    const store = createStateStore(stateDir, base);
    const state = createProcessState("alpha");
    await store.write(state.id, state);
    await base.mkdir(path.join(processDir, "logs"), { recursive: true });
    await base.writeFile(path.join(processDir, "logs", "stdout.log"), "hello\n");
    const fs = {
      ...base,
      rmdir: async (directoryPath: string) => {
        if (directoryPath.includes(".state-removed-")) {
          throw new Error("simulated final directory removal failure");
        }
        await rawFs.rmdir(directoryPath);
      }
    } as LauncherFileSystem;

    await expect(createStateStore(stateDir, fs).remove(state.id)).resolves.toBeUndefined();
    await expect(store.read(state.id)).resolves.toBeNull();
    await expect(createStateStore(stateDir, fs).list()).resolves.toEqual([]);
    await expect(rawFs.readdir(stateDir)).resolves.toEqual(expect.arrayContaining([
      expect.stringMatching(/^\.state-removed-/)
    ]));
  });

  it("remove() is safe to call for non-existent id", async () => {
    const store = createStateStore("/state", createMemFs());

    await expect(store.remove("missing")).resolves.toBeUndefined();
  });

  it("write() overwrites existing state", async () => {
    const fs = createMemFs();
    const stateDir = "/state";
    const store = createStateStore(stateDir, fs);
    const initial = createProcessState("alpha");
    const updated = createProcessState("alpha", {
      pid: null,
      status: "crashed",
      restartCount: 2,
      lastExitCode: 1,
      lastStoppedAt: "2026-04-02T12:10:00.000Z"
    });

    await store.write(initial.id, initial);
    await store.write(updated.id, updated);

    await expect(store.read(updated.id)).resolves.toEqual(updated);
  });

  it("rejects reads and writes through a symlinked state file", async () => {
    const fs = createMemFs();
    const outside = createProcessState("alpha", { status: "stopped" });
    const updated = createProcessState("alpha", { status: "running", pid: 123 });
    await fs.mkdir("/state/alpha", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/state.json", `${JSON.stringify(outside)}\n`);
    await (fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside/state.json",
      "/state/alpha/state.json"
    );
    const store = createStateStore("/state", fs);

    await expect(store.read("alpha")).rejects.toThrow("symbolic link");
    await expect(store.write("alpha", updated)).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/state.json", "utf8")).resolves.toBe(`${JSON.stringify(outside)}\n`);
  });

  it("does not follow a preexisting legacy temporary state symlink", async () => {
    const fs = createMemFs();
    const updated = createProcessState("alpha", { status: "running", pid: 123 });
    await fs.mkdir("/state/alpha", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/state.json.tmp", "outside-state\n");
    await (fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside/state.json.tmp",
      "/state/alpha/state.json.tmp"
    );
    const store = createStateStore("/state", fs);

    await store.write("alpha", updated);
    await expect(fs.readFile("/outside/state.json.tmp", "utf8")).resolves.toBe("outside-state\n");
    await expect(store.read("alpha")).resolves.toEqual(updated);
  });

  it("does not remove a colliding temporary state symlink it did not create", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const base = rawFs as unknown as LauncherFileSystem;
    const statePath = "/state/alpha/state.json";
    const updated = createProcessState("alpha", { status: "running", pid: 123 });
    let temporaryPath: string | undefined;
    await base.mkdir("/state/alpha", { recursive: true });
    await base.mkdir("/outside", { recursive: true });
    await base.writeFile("/outside/state.json.tmp", "outside-state\n");
    const fs = {
      ...base,
      writeFile: async (
        filePath: string,
        content: string,
        options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
      ) => {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${statePath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync("/outside/state.json.tmp", filePath);
        }

        await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
      }
    } as LauncherFileSystem;

    await expect(createStateStore("/state", fs).write(updated.id, updated)).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(temporaryPath).toBeDefined();
    await expect(base.readFile("/outside/state.json.tmp", "utf8")).resolves.toBe("outside-state\n");
    const tempStat = await base.lstat(temporaryPath as string);
    expect(tempStat.isSymbolicLink()).toBe(true);
    await expect(createStateStore("/state", base).read("alpha")).resolves.toBeNull();
  });

  it("removes partial temporary state files when write errors only inherit existing-path codes", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const base = rawFs as unknown as LauncherFileSystem;
    const statePath = "/state/alpha/state.json";
    const updated = createProcessState("alpha", { status: "running", pid: 123 });
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      writeFile: async (
        filePath: string,
        content: string,
        options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
      ) => {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${statePath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          await rawFs.writeFile(filePath, "{", options ?? { encoding: "utf8" });
          throw new Error("state temp denied");
        }

        await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
      }
    } as LauncherFileSystem;

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(createStateStore("/state", fs).write(updated.id, updated)).rejects.toThrow(
        "state temp denied"
      );
    });

    expect(temporaryPath).toBeDefined();
    await expect(base.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects removals through a symlinked process directory", async () => {
    const fs = createMemFs();
    await fs.mkdir("/outside/alpha", { recursive: true });
    await fs.writeFile("/outside/alpha/state.json", `${JSON.stringify(createProcessState("alpha"))}\n`);
    await fs.mkdir("/state", { recursive: true });
    await (fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside/alpha",
      "/state/alpha"
    );

    await expect(createStateStore("/state", fs).remove("alpha")).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/alpha/state.json", "utf8")).resolves.toContain('"id":"alpha"');
  });

  it("rejects removals through a symlinked state directory", async () => {
    const fs = createMemFs();
    await fs.mkdir("/outside/alpha", { recursive: true });
    await fs.writeFile("/outside/alpha/state.json", `${JSON.stringify(createProcessState("alpha"))}\n`);
    await (fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/state"
    );

    await expect(createStateStore("/state", fs).remove("alpha")).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/alpha/state.json", "utf8")).resolves.toContain('"id":"alpha"');
  });

  it("rejects path traversal ids for all state operations", async () => {
    const fs = createMemFs();
    const store = createStateStore("/state", fs);
    const escaped = createProcessState("../outside");

    await expect(store.write(escaped.id, escaped)).rejects.toThrow(/process id/i);
    await expect(store.read(escaped.id)).rejects.toThrow(/process id/i);
    await expect(store.remove(escaped.id)).rejects.toThrow(/process id/i);
    await expect(fs.readFile("/outside/state.json", "utf8")).rejects.toThrow();
  });

  it("preserves existing state if an updated write fails", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const base = rawFs as unknown as LauncherFileSystem;
    const statePath = "/state/alpha/state.json";
    const initial = createProcessState("alpha");
    const updated = createProcessState("alpha", { pid: null, status: "crashed", lastExitCode: 1 });
    const store = createStateStore("/state", base);
    await store.write(initial.id, initial);
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      writeFile: async (
        filePath: string,
        content: string,
        options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
      ) => {
        if (filePath.startsWith(`${statePath}.`) && filePath.endsWith(".tmp")) {
          temporaryPath = filePath;
          await rawFs.writeFile(filePath, "{", options ?? { encoding: "utf8" });
          throw new Error("state disk full");
        }

        await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
      }
    } as LauncherFileSystem;

    await expect(createStateStore("/state", fs).write(updated.id, updated)).rejects.toThrow("state disk full");
    await expect(store.read(initial.id)).resolves.toEqual(initial);
    expect(temporaryPath).toBeDefined();
    await expect(base.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
