import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createCheckCache } from "./check-cache.mjs";
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: vi.fn(() => "GIT_DIR\nGIT_INDEX_FILE\n")
}));
import { buildWorkspaces, testWorkspaces } from "./build-workspaces.mjs";
import { runCiBashShard } from "./run-ci-bash-shard.mjs";

function fixture() {
  const files = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "node unit.mjs" } }),
    "turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] }, "test:unit": {} } }),
    "packages/alpha/package.json": JSON.stringify({ name: "alpha", scripts: { "test:unit": "cd ../.. && vitest run packages/alpha/src --pool=forks" } }),
    "packages/alpha/src/unit.test.ts": "export {};",
    "packages/beta/package.json": JSON.stringify({ name: "beta", scripts: { "test:unit": "vitest run --config vitest.config.ts" } }),
    "packages/beta/vitest.config.ts": 'import { defineConfig } from "vitest/config"; export default defineConfig({test: {include: ["src/**/*.test.ts"]}});',
    "packages/beta/src/unit.test.ts": "export {};",
    "packages/native/package.json": JSON.stringify({ name: "native", scripts: { "test:unit": "node --test" } })
  };
  const fileSystem = createFsFromVolume(Volume.fromJSON(Object.fromEntries(Object.entries(files).map(([name, value]) => ["/repo/" + name, value]))));
  const spawn = vi.fn(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit("close", 0, null)); return child; });
  const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: process.execPath, kill: vi.fn() });
  return { fileSystem, spawn, host, environment: { npm_execpath: "/npm-cli.js" }, cacheFiles: Object.keys(files), cacheStore: createCheckCache({ directory: "/cache", fileSystem }) };
}

describe("native Vitest workspace result cache", () => {
  it("reuses successful configured and explicit-pool checks while root and other native tasks stay fresh", async () => {
    const state = fixture();
    await testWorkspaces("/repo", state);
    expect(state.spawn).toHaveBeenCalledTimes(4);
    const result = await testWorkspaces("/repo", state);
    expect(state.spawn).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ unitCacheHits: 2, unitCacheMisses: 0 });
  });

  it("invalidates changed native workspace inputs and obeys fresh execution", async () => {
    const state = fixture();
    await testWorkspaces("/repo", state);
    state.fileSystem.writeFileSync("/repo/packages/alpha/src/unit.test.ts", "changed");
    await testWorkspaces("/repo", state);
    expect(state.spawn).toHaveBeenCalledTimes(7);
    await testWorkspaces("/repo", { ...state, cache: false });
    expect(state.spawn).toHaveBeenCalledTimes(11);
  });

  it("preserves uncached overrides and npm lifecycle hooks", async () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { cache: false } } }));
    state.fileSystem.writeFileSync("/repo/packages/beta/package.json", JSON.stringify({ name: "beta", scripts: { "test:unit": "vitest run --config vitest.config.ts", "pretest:unit": "node prepare.mjs" } }));
    await testWorkspaces("/repo", state);
    await testWorkspaces("/repo", state);
    expect(state.spawn).toHaveBeenCalledTimes(8);
  });
  it("caches eligible node --import tsx --test workspaces without requiring a Vitest stage", async () => {
    const state = fixture();
    state.fileSystem.mkdirSync("/repo/packages/tsx-native/src", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/tsx-native/package.json", JSON.stringify({
      name: "tsx-native",
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    }), { flag: "w" });
    state.fileSystem.writeFileSync("/repo/packages/tsx-native/src/unit.test.ts", "export {};");
    state.cacheFiles.push("packages/tsx-native/package.json", "packages/tsx-native/src/unit.test.ts");
    const first = await testWorkspaces("/repo", { ...state, workspaces: ["tsx-native"] });
    expect(first).toMatchObject({ unitCacheHits: 0, unitCacheMisses: 1 });
    const second = await testWorkspaces("/repo", { ...state, workspaces: ["tsx-native"] });
    expect(second).toMatchObject({ unitCacheHits: 1, unitCacheMisses: 0 });
  });

  it("caches eligible *-rust cargo.mjs test workspaces and known pretest hook workspaces", async () => {
    const state = fixture();
    state.fileSystem.mkdirSync("/repo/packages/sample-rust/src", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/package.json", JSON.stringify({
      name: "sample-rust",
      scripts: { "test:unit": "node ../mcp-protocol-rust/scripts/cargo.mjs test" }
    }), { flag: "w" });
    state.fileSystem.mkdirSync("/repo/packages/sample-rust/bindings", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/bindings/Cargo.toml", "[package]\nname = \"sample\"\n", { flag: "w" });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/src/lib.rs", "pub fn ok() {}");
    state.cacheFiles.push("packages/sample-rust/package.json", "packages/sample-rust/bindings/Cargo.toml", "packages/sample-rust/src/lib.rs");
    const first = await testWorkspaces("/repo", { ...state, workspaces: ["sample-rust"] });
    expect(first).toMatchObject({ unitCacheHits: 0, unitCacheMisses: 1 });
    const second = await testWorkspaces("/repo", { ...state, workspaces: ["sample-rust"] });
    expect(second).toMatchObject({ unitCacheHits: 1, unitCacheMisses: 0 });
    state.fileSystem.mkdirSync("/repo/packages/hooked/src", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/hooked/package.json", JSON.stringify({
      name: "hooked",
      scripts: { "pretest:unit": "npm run build", "test:unit": "cd ../.. && vitest run packages/hooked/src --pool=forks" }
    }), { flag: "w" });
    state.fileSystem.writeFileSync("/repo/packages/hooked/src/unit.test.ts", "export {};");
    state.cacheFiles.push("packages/hooked/package.json", "packages/hooked/src/unit.test.ts");
    const hookFirst = await testWorkspaces("/repo", { ...state, workspaces: ["hooked"] });
    expect(hookFirst).toMatchObject({ unitCacheHits: 0, unitCacheMisses: 1 });
    const hookSecond = await testWorkspaces("/repo", { ...state, workspaces: ["hooked"] });
    expect(hookSecond).toMatchObject({ unitCacheHits: 1, unitCacheMisses: 0 });
  });
  it("caches *-rust cargo.mjs build outputs in prepareBuildCache", async () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] }, "test:unit": {} } }), { flag: "w" });
    state.fileSystem.mkdirSync("/repo/packages/sample-rust/src", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/package.json", JSON.stringify({
      name: "sample-rust",
      scripts: { build: "node ../mcp-protocol-rust/scripts/cargo.mjs build" }
    }), { flag: "w" });
    state.fileSystem.mkdirSync("/repo/packages/sample-rust/bindings", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/bindings/Cargo.toml", "[package]\nname = \"sample\"\n", { flag: "w" });
    state.fileSystem.writeFileSync("/repo/packages/sample-rust/src/lib.rs", "pub fn ok() {}");
    state.cacheFiles.push("packages/sample-rust/package.json", "packages/sample-rust/bindings/Cargo.toml", "packages/sample-rust/src/lib.rs");
    const buildSpawn = vi.fn(() => {
      state.fileSystem.mkdirSync("/repo/packages/sample-rust/dist", { recursive: true });
      state.fileSystem.writeFileSync("/repo/packages/sample-rust/dist/index.js", "export const ok = true;");
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });
    const first = await buildWorkspaces("/repo", { ...state, spawn: buildSpawn, workspace: "sample-rust" });
    expect(first).toMatchObject({ builds: 1, cacheHits: 0, cacheMisses: 1 });
    const second = await buildWorkspaces("/repo", { ...state, spawn: buildSpawn, workspace: "sample-rust" });
    expect(second).toMatchObject({ builds: 1, cacheHits: 1, cacheMisses: 0 });
    expect(buildSpawn).toHaveBeenCalledTimes(1);
  });

  it("caches CI Bash shard execution per shard and oracle digest via runCiBashShard", () => {
    const state = fixture();
    const spawn = vi.fn(() => ({ status: 0 }));
    const env = {
      ...state.environment,
      SAFE_BASH_TEST_SHARD: "2/4",
      SAFE_BASH_TEST_CONCURRENCY: "2",
      SAFE_BASH_TEST_BASH_SHA256: "abc123"
    };
    expect(runCiBashShard(process.cwd(), { environment: env, spawn, cacheStore: state.cacheStore })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runCiBashShard(process.cwd(), { environment: env, spawn, cacheStore: state.cacheStore })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runCiBashShard(process.cwd(), { environment: { ...env, SAFE_BASH_TEST_SHARD: "3/4" }, spawn, cacheStore: state.cacheStore })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it("admits all 211 repository workspace builds to prepareBuildCache and all non-safe-bash native unit stages to prepareNativeUnitCache", async () => {
    const { createWorkspaceTestPlan } = await import("./build-workspaces.mjs");
    const { sharedVitestStages } = await import("./test-vitest-workspaces.mjs");
    const { prepareBuildCache, prepareNativeUnitCache } = await import("./check-cache.mjs");
    const realFs = await import("node:fs");
    const plan = createWorkspaceTestPlan(process.cwd(), { fileSystem: realFs });
    const stages = sharedVitestStages(plan, realFs);
    const fakeStore = {
      read: () => ({ success: true, outputs: [{ path: "dist/index.js", mode: 0o644, bytes: "" }] }),
      write: () => {},
      restore: () => {},
      capture: () => []
    };
    const buildCache = prepareBuildCache(plan, plan.buildStages, { cacheStore: fakeStore, cacheFiles: ["package.json"], environment: {}, fileSystem: realFs });
    for (const stage of plan.buildStages) {
      const prevHits = buildCache.stats.cacheHits;
      const prevMisses = buildCache.stats.cacheMisses;
      buildCache.restore(stage);
      expect(buildCache.stats.cacheHits + buildCache.stats.cacheMisses, "Uncached build stage: " + stage.name).toBe(prevHits + prevMisses + 1);
    }

    const unitCache = prepareNativeUnitCache(plan, stages, { cacheStore: fakeStore, cacheFiles: ["package.json"], environment: {}, fileSystem: realFs });
    for (const stage of stages) {
      if (stage.event === "test:unit:shared" || stage.name === "@poe-platform/safe-bash") continue;
      expect(unitCache?.restore(stage), "Uncached native unit stage: " + stage.name).toBe(true);
    }
  });

  it("injects --test-concurrency=1 into NODE_OPTIONS for non-safe-bash unit tasks so node --test never spawns parallel workers", async () => {
    const state = fixture();
    const observedOptions: Record<string, string | undefined> = {};
    const spawn = vi.fn((_exec, args, opts) => {
      const wsArg = args.find((a: string) => a.startsWith("--workspace="));
      observedOptions[wsArg ?? "root"] = opts?.env?.NODE_OPTIONS;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });
    await testWorkspaces("/repo", { ...state, spawn, cache: false });
    expect(observedOptions["--workspace=packages/native"]).toContain("--test-concurrency=1");
  });
});
