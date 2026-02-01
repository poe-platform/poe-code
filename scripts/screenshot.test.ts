import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveScreenshotTimeoutMs } from "./screenshot.js";

describe("resolveScreenshotTimeoutMs", () => {
  it("uses default when env is missing or invalid", () => {
    expect(resolveScreenshotTimeoutMs({})).toBe(30000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "" })).toBe(30000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "0" })).toBe(30000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "-1" })).toBe(30000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "nope" })).toBe(30000);
  });

  it("uses the provided timeout when valid", () => {
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "12000" })).toBe(12000);
  });
});

describe("resolveFreezeCommand", () => {
  afterEach(() => {
    vi.unmock("node:child_process");
    vi.unmock("node:fs");
    vi.unmock("node:process");
    vi.unmock("node:module");
  });

  async function loadWithMocks({
    exists,
    access,
    pathEnv,
    resolveError,
    spawnResults
  }: {
    exists: (value: string) => boolean;
    access: (value: string) => void;
    pathEnv?: string;
    resolveError?: boolean;
    spawnResults?: Record<string, number | null>;
  }) {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      existsSync: (value: string) => exists(value),
      accessSync: (value: string) => access(value),
      constants: { X_OK: 1 }
    }));
    vi.doMock("node:child_process", () => ({
      spawnSync: (command: string) => ({
        status: spawnResults?.[command] ?? null
      })
    }));
    vi.doMock("node:process", () => ({
      env: { PATH: pathEnv ?? "" }
    }));
    if (resolveError) {
      vi.doMock("node:module", () => ({
        createRequire: () => ({
          resolve: () => {
            throw new Error("missing");
          }
        })
      }));
    }
    return await import("./screenshot.js");
  }

  it("uses the override path when provided", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: () => true,
      access: () => undefined,
      spawnResults: { freeze: 1 }
    });
    expect(
      resolveFreezeCommand({ POE_FREEZE_PATH: "/tmp/freeze" })
    ).toBe("/tmp/freeze");
  });

  it("throws when the override path is missing", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: () => false,
      access: () => undefined,
      spawnResults: { freeze: 1 }
    });
    expect(() =>
      resolveFreezeCommand({ POE_FREEZE_PATH: "/tmp/missing" })
    ).toThrow("POE_FREEZE_PATH");
  });

  it("prefers a freeze binary on PATH", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: (value) => value === "/opt/bin/freeze",
      access: () => undefined,
      pathEnv: "/opt/bin:/usr/bin",
      spawnResults: { freeze: 1 }
    });
    expect(resolveFreezeCommand({})).toBe("/opt/bin/freeze");
  });

  it("falls back to common system paths when PATH misses freeze", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: (value) => value === "/opt/homebrew/bin/freeze",
      access: () => undefined,
      pathEnv: "",
      spawnResults: {
        freeze: 1,
        "/opt/homebrew/bin/freeze": 0
      }
    });
    expect(resolveFreezeCommand({})).toBe("/opt/homebrew/bin/freeze");
  });

  it("skips node_modules/.bin when resolving PATH", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: (value) =>
        value === "/opt/bin/freeze" || value === "/repo/node_modules/.bin/freeze",
      access: () => undefined,
      pathEnv: "/repo/node_modules/.bin:/opt/bin:/usr/bin",
      spawnResults: { freeze: 1 }
    });
    expect(resolveFreezeCommand({})).toBe("/opt/bin/freeze");
  });

  it("uses system freeze when available", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: () => false,
      access: () => undefined,
      spawnResults: { freeze: 0 }
    });
    expect(resolveFreezeCommand({})).toBe("freeze");
  });

  it("falls back to bundled freeze-cli binary", async () => {
    const { resolveFreezeCommand } = await loadWithMocks({
      exists: () => false,
      access: () => undefined,
      spawnResults: { freeze: 1 }
    });
    const resolved = resolveFreezeCommand({});
    expect(resolved.includes("@poe-code/freeze-cli")).toBe(true);
    expect(resolved.endsWith("bin/freeze")).toBe(true);
  });
});
