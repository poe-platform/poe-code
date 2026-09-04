import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaces, parseWorkspaceArguments } from "./build-workspaces.mjs";

function fixture() {
  const root = "/workspace-build-parallel";
  const files = {
    "package.json": { name: "root", private: true, workspaces: ["packages/*"] },
    "turbo.json": { tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] } } },
    "packages/alpha/package.json": {
      name: "alpha",
      version: "1.0.0",
      scripts: { build: "build-alpha" },
      dependencies: { beta: "*", gamma: "*" }
    },
    "packages/beta/package.json": {
      name: "beta",
      version: "1.0.0",
      scripts: { prebuild: "before", build: "build-beta", postbuild: "after" }
    },
    "packages/gamma/package.json": {
      name: "gamma",
      version: "1.0.0",
      scripts: { build: "build-gamma" }
    }
  };
  const fileSystem = createFsFromVolume(
    Volume.fromJSON(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [root + "/" + name, JSON.stringify(value)])
      )
    )
  );
  const host = Object.assign(new EventEmitter(), {
    platform: "linux",
    execPath: process.execPath,
    kill: vi.fn()
  });
  const children: EventEmitter[] = [];
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    children.push(child);
    return child;
  });
  return {
    root,
    fileSystem,
    host,
    children,
    spawn,
    environment: { npm_execpath: "/owned/npm-cli.js" }
  };
}

describe("dependency-layer workspace builds", () => {
  it("accepts a bounded build concurrency option alongside an exact workspace", () => {
    expect(parseWorkspaceArguments(["--concurrency=1"])).toEqual({ mode: "build", concurrency: 1 });
    expect(parseWorkspaceArguments(["--workspace=alpha", "--concurrency=2"])).toEqual({
      mode: "build",
      workspace: "alpha",
      concurrency: 2
    });
    for (const args of [
      ["--concurrency=0"],
      ["--concurrency=3"],
      ["--concurrency=1", "--concurrency=2"],
      ["--workspace=alpha", "--workspace=beta"]
    ]) {
      expect(() => parseWorkspaceArguments(args)).toThrow();
    }
  });

  it("starts independent builds together and waits before starting dependents", async () => {
    const state = fixture();
    const running = buildWorkspaces(state.root, state);
    const initial = state.children.length;
    state.children[0]!.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.children.length).toBe(2);
    state.children[1]!.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.children.length).toBe(3);
    state.children[2]!.emit("close", 0, null);
    expect(await running).toMatchObject({ builds: 3 });
    expect(initial).toBe(2);
    expect(state.host.listenerCount("SIGINT")).toBe(0);
    expect(state.host.listenerCount("SIGTERM")).toBe(0);
  });

  it("does not start dependents after a failed build", async () => {
    const state = fixture();
    const running = buildWorkspaces(state.root, state);
    const rejected = expect(running).rejects.toMatchObject({ exitCode: 7 });
    state.children[0]!.emit("close", 7, null);
    state.children[1]?.emit("close", 0, null);
    await rejected;
    expect(state.children.length).toBe(2);
  });

  it("supports explicit serial execution", async () => {
    const state = fixture();
    const running = buildWorkspaces(state.root, { ...state, concurrency: 1 });
    for (let index = 0; index < 3; index++) {
      expect(state.children.length).toBe(index + 1);
      state.children[index]!.emit("close", 0, null);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await running).toMatchObject({ builds: 3 });
  });

  it("terminates a running sibling when another build fails", async () => {
    const state = fixture();
    const live = new Map<number, EventEmitter>();
    state.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 9100 + state.children.length });
      state.children.push(child);
      live.set(child.pid, child);
      child.once("close", () => live.delete(child.pid));
      return child;
    });
    state.host.kill.mockImplementation((group: number, signal: string | number) => {
      const child = live.get(-group);
      if (!child) throw Object.assign(new Error("not running"), { code: "ESRCH" });
      if (signal !== 0) queueMicrotask(() => child.emit("close", null, signal));
      return true;
    });
    const running = buildWorkspaces(state.root, { ...state, concurrency: 2 });
    const rejected = expect(running).rejects.toMatchObject({ exitCode: 7 });
    state.children[0]!.emit("close", 7, null);
    await new Promise((resolve) => setImmediate(resolve));
    const terminated = state.host.kill.mock.calls.some(
      ([group, signal]) => group === -9101 && signal === "SIGTERM"
    );
    if (!terminated) state.children[1]!.emit("close", 0, null);
    await rejected;
    expect(terminated).toBe(true);
    expect(state.children).toHaveLength(2);
    expect(live.size).toBe(0);
  });
});
