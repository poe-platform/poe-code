import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaces, parseWorkspaceArguments } from "./build-workspaces.mjs";
import { createCheckCache } from "./check-cache.mjs";

function fixture() {
  const root = "/repo";
  const files = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] } } }),
    "packages/alpha/package.json": JSON.stringify({ name: "alpha", scripts: { build: "tsc" }, dependencies: { beta: "*" } }),
    "packages/beta/package.json": JSON.stringify({ name: "beta", scripts: { build: "tsc" } }),
    "packages/alpha/src/index.ts": "alpha", "packages/beta/src/index.ts": "beta"
  };
  const fileSystem = createFsFromVolume(Volume.fromJSON(Object.fromEntries(Object.entries(files).map(([file, value]) => [root + "/" + file, value]))));
  const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: process.execPath, kill: vi.fn() });
  const spawn = vi.fn((_command, args) => {
    const workspace = args.find(arg => arg.startsWith("--workspace=")).slice("--workspace=".length);
    fileSystem.mkdirSync(root + "/" + workspace + "/dist", { recursive: true });
    fileSystem.writeFileSync(root + "/" + workspace + "/dist/index.js", "built " + workspace);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  });
  return { root, fileSystem, host, spawn, environment: { npm_execpath: "/owned/npm-cli.js" },
    cacheStore: createCheckCache({ directory: "/cache", fileSystem }), cacheFiles: Object.keys(files) };
}

describe("workspace build caching", () => {
  it("reports owned process-group context without treating inspection refusal as success", async () => {
    const state = fixture();
    const refusal = Object.assign(new Error("inspection refused"), { code: "EPERM" });
    state.host.kill.mockImplementation(() => { throw refusal; });
    state.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 9000 });
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });
    const diagnostics = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(buildWorkspaces(state.root, { ...state, cache: false, concurrency: 1 })).rejects.toBe(refusal);
      expect(diagnostics).toHaveBeenCalledWith(expect.stringContaining(`beta: parent PID ${process.pid}, child PID 9000, process group 9000`));
      expect(state.spawn).toHaveBeenCalledTimes(1);
    } finally { diagnostics.mockRestore(); }
  });
  it("exposes explicit uncached execution for both maintained routes", () => {
    expect(parseWorkspaceArguments(["--no-cache"])).toEqual({ mode: "build", cache: false });
    expect(parseWorkspaceArguments(["--test-unit", "--no-cache"]).cache).toBe(false);
  });
  it("restores successful build artifacts without executing npm again", async () => {
    const state = fixture();
    await buildWorkspaces(state.root, state);
    expect(state.spawn).toHaveBeenCalledTimes(2);
    state.fileSystem.rmSync("/repo/packages/alpha/dist", { recursive: true });
    const result = await buildWorkspaces(state.root, state);
    expect(state.spawn).toHaveBeenCalledTimes(2);
    expect(state.fileSystem.readFileSync("/repo/packages/alpha/dist/index.js", "utf8")).toBe("built packages/alpha");
    expect(result).toMatchObject({ builds: 2, cacheHits: 2 });
  });

  it("rebuilds changed dependencies and consumers, and permits explicit uncached execution", async () => {
    const state = fixture();
    await buildWorkspaces(state.root, state);
    state.fileSystem.writeFileSync("/repo/packages/beta/src/index.ts", "changed");
    await buildWorkspaces(state.root, state);
    expect(state.spawn).toHaveBeenCalledTimes(4);
    await buildWorkspaces(state.root, { ...state, cache: false });
    expect(state.spawn).toHaveBeenCalledTimes(6);
  });

  it("restores generated Intl source artifacts alongside compiled output in a clean checkout", async () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: {
      build: { dependsOn: ["^build"], outputs: ["dist/**"] },
      "beta#build": { dependsOn: ["^build"], outputs: ["dist/**", "src/intl-data/dist/**"] }
    } }));
    const originalSpawn = state.spawn;
    const spawn = vi.fn((...args) => {
      if (args[1].includes("--workspace=packages/beta")) {
        state.fileSystem.mkdirSync("/repo/packages/beta/src/intl-data/dist", { recursive: true });
        state.fileSystem.writeFileSync("/repo/packages/beta/src/intl-data/dist/numberformat.js", "generated locale data");
      }
      return originalSpawn(...args);
    });
    await buildWorkspaces(state.root, { ...state, spawn });
    state.fileSystem.rmSync("/repo/packages/beta/dist", { recursive: true });
    state.fileSystem.rmSync("/repo/packages/beta/src/intl-data/dist", { recursive: true });
    const result = await buildWorkspaces(state.root, { ...state, spawn });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ cacheHits: 2 });
    expect(state.fileSystem.readFileSync("/repo/packages/beta/dist/index.js", "utf8")).toBe("built packages/beta");
    expect(state.fileSystem.readFileSync("/repo/packages/beta/src/intl-data/dist/numberformat.js", "utf8")).toBe("generated locale data");
    expect(state.fileSystem.readFileSync("/repo/packages/beta/src/index.ts", "utf8")).toBe("beta");
  });

  it("does not publish a build cache entry when its inputs change during execution", async () => {
    const state = fixture();
    const originalSpawn = state.spawn;
    const spawn = vi.fn((...args) => {
      const child = originalSpawn(...args);
      if (args[1].includes("--workspace=packages/alpha")) state.fileSystem.writeFileSync("/repo/packages/alpha/src/index.ts", "changed during build");
      return child;
    });
    await buildWorkspaces(state.root, { ...state, spawn });
    state.fileSystem.writeFileSync("/repo/packages/alpha/src/index.ts", "alpha");
    await buildWorkspaces(state.root, state);
    expect(state.spawn).toHaveBeenCalledTimes(3);
  });

  it("keeps distinct artifacts for packages in an inferred source import cycle", async () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/packages/beta/src/index.ts", 'export { value } from "alpha";');
    await buildWorkspaces(state.root, state);
    await buildWorkspaces(state.root, state);
    expect(state.fileSystem.readFileSync("/repo/packages/beta/dist/index.js", "utf8")).toBe("built packages/beta");
    expect(state.fileSystem.readFileSync("/repo/packages/alpha/dist/index.js", "utf8")).toBe("built packages/alpha");
  });

  it("runs lifecycle hooks fresh instead of reusing a partial artifact snapshot", async () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/packages/beta/package.json", JSON.stringify({ name: "beta", scripts: { build: "tsc", postbuild: "node extra.mjs" } }));
    await buildWorkspaces(state.root, state);
    await buildWorkspaces(state.root, state);
    expect(state.spawn).toHaveBeenCalledTimes(3);
  });

  it("flushes completed prerequisite build artifacts when a downstream workspace fails", async () => {
    const state = fixture();
    let failAlpha = true;
    const originalSpawn = state.spawn;
    const spawn = vi.fn((command, args, options) => {
      if (failAlpha && args.includes("--workspace=packages/alpha")) {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("close", 1, null));
        return child;
      }
      return originalSpawn(command, args, options);
    });
    await expect(buildWorkspaces(state.root, { ...state, spawn })).rejects.toThrow();
    expect(spawn).toHaveBeenCalledTimes(2);
    failAlpha = false;
    const result = await buildWorkspaces(state.root, { ...state, spawn });
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ builds: 2, cacheHits: 1, cacheMisses: 1 });
  });
  it("reads cached build payloads larger than 128MB uncompressed and prunes oldest entries when exceeding maxDirectoryBytes", () => {
    const state = fixture();
    const cache = createCheckCache({
      directory: "/repo/.cache/checks-v1",
      fileSystem: state.fileSystem,
      maxDirectoryBytes: 200_000,
      targetDirectoryBytes: 150_000
    });
    const coldKey = "a".repeat(64);
    const warmKey = "b".repeat(64);
    const newKey = "c".repeat(64);
    cache.write(coldKey, { success: true, payload: "x".repeat(140 * 1024 * 1024) });
    cache.write(warmKey, { success: true, payload: "y".repeat(40 * 1024 * 1024) });
    expect(cache.read(warmKey)?.success).toBe(true);
    cache.write(newKey, { success: true, payload: "z".repeat(40 * 1024 * 1024) });
    expect(cache.read(newKey)?.success).toBe(true);
    expect(cache.read(warmKey)?.success).toBe(true);
    expect(cache.read(coldKey)).toBeNull();
  });
});
