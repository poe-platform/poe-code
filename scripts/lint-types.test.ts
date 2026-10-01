import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ status: 0 })),
  exists: vi.fn(() => true),
  mkdir: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", () => ({ default: {
  existsSync: mocks.exists, mkdirSync: mocks.mkdir,
  readdirSync: () => [], readFileSync: () => "{}",
} }));
vi.mock("./check-cache.mjs", () => ({ createCheckCache: () => ({ read: () => ({ success: true }), write: vi.fn() }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.resetModules(); });

it("refreshes existing workspace declarations and runs every type contract despite an old success receipt", async () => {
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("premature cached success"); });
  await import("./lint-types.mjs");
  expect(mocks.spawn.mock.calls.map(call => (call as unknown[])[1])).toEqual([
    ["scripts/build-workspaces.mjs"],
    ["-p", "tsconfig.build.json", "--noEmit", "--incremental", "--tsBuildInfoFile", ".turbo/types/root.tsbuildinfo"],
    ["run", "typecheck:contracts", "--workspace=@poe-code/safe-js"],
    ["run", "typecheck:contracts", "--workspace=tiny-mcp-client"],
  ]);
});

it("forwards fresh verification to the maintained workspace builder", async () => {
  vi.stubEnv("POE_CHECK_NO_CACHE", "1");
  await import("./lint-types.mjs");
  expect(mocks.spawn).toHaveBeenNthCalledWith(1, process.execPath,
    ["scripts/build-workspaces.mjs", "--no-cache"], expect.anything());
});

it("stops before root checking if workspace declaration refresh fails", async () => {
  mocks.spawn.mockReturnValueOnce({ status: 2 });
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("build failed"); });
  await expect(import("./lint-types.mjs")).rejects.toThrow("build failed");
  expect(exit).toHaveBeenCalledWith(2);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});
