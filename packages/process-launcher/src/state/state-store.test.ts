import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { createStateStore } from "./state-store.js";
import type { LauncherFileSystem, ProcessState } from "../types.js";

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
    const fs = {
      ...base,
      writeFile: async (filePath: string, content: string) => {
        if (filePath === `${statePath}.tmp`) {
          await rawFs.writeFile(filePath, "{", { encoding: "utf8" });
          throw new Error("state disk full");
        }

        await rawFs.writeFile(filePath, content, { encoding: "utf8" });
      }
    } as LauncherFileSystem;

    await expect(createStateStore("/state", fs).write(updated.id, updated)).rejects.toThrow("state disk full");
    await expect(store.read(initial.id)).resolves.toEqual(initial);
  });
});
