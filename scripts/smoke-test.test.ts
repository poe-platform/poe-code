import { afterEach, describe, expect, it, vi } from "vitest";

const originalArguments = process.argv;
afterEach(() => {
  process.argv = originalArguments;
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("packed smoke build selection", () => {
  it("runs the temporary installed CLI without mutating the global installation", async () => {
    const stop = new Error("installed CLI observed");
    const execSync = vi.fn(() => "");
    const spawnSync = vi.fn(() => {
      throw stop;
    });
    vi.doMock("node:child_process", () => ({ execSync, spawnSync }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi
        .fn()
        .mockReturnValueOnce("/smoke-owned/pack")
        .mockReturnValueOnce("/smoke-owned/sdk"),
      readdirSync: vi.fn(() => ["poe-code.tgz"]),
      rmSync: vi.fn()
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", "--prebuilt"];
    await expect(import("./smoke-test.js")).rejects.toThrow(stop);
    expect(execSync.mock.calls.some(([command]) => String(command).includes(" -g "))).toBe(false);
    expect(spawnSync).toHaveBeenCalledWith(
      "/smoke-owned/sdk/node_modules/.bin/poe-code",
      ["--version"],
      expect.objectContaining({ cwd: "/smoke-owned/sdk", timeout: 30000 })
    );
  });

  it.each([false, true])("skips only the pack lifecycle when prebuilt=%s", async (prebuilt) => {
    const stop = new Error("packing observed");
    const execSync = vi.fn(() => {
      throw stop;
    });
    vi.doMock("node:child_process", () => ({ execSync, spawnSync: vi.fn() }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi.fn(() => "/smoke-owned")
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", ...(prebuilt ? ["--prebuilt"] : [])];
    await expect(import("./smoke-test.js")).rejects.toThrow(stop);
    expect(execSync).toHaveBeenCalledWith(
      `npm pack --pack-destination "/smoke-owned" --silent${prebuilt ? " --ignore-scripts" : ""}`,
      { stdio: "pipe" }
    );
  });
});
