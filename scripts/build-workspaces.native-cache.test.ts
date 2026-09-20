import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createCheckCache } from "./check-cache.mjs";
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: vi.fn(() => "GIT_DIR\nGIT_INDEX_FILE\n")
}));
import { testWorkspaces } from "./build-workspaces.mjs";

function fixture() {
  const files = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "node unit.mjs" } }),
    "turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] }, "test:unit": {} } }),
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
});
