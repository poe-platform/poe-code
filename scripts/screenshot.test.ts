import { beforeEach, describe, it, expect, vi } from "bun:test";
import { resolveFreezeCommand, resolveScreenshotTimeoutMs } from "./screenshot.js";

describe("resolveScreenshotTimeoutMs", () => {
  it("uses default when env is missing or invalid", () => {
    expect(resolveScreenshotTimeoutMs({})).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "0" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "-1" })).toBe(60000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "nope" })).toBe(60000);
  });

  it("uses the provided timeout when valid", () => {
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "12000" })).toBe(12000);
  });
});

const existsSync = vi.fn<[string], boolean>();
const accessSync = vi.fn<(path: string, mode?: number) => void>();
const spawnSync = vi.fn<[string, string[], object], { status: number | null }>();
let resolveImpl: (() => string) | null = null;

const deps = {
  existsSync: (path: string) => existsSync(path),
  accessSync: (path: string, mode?: number) => accessSync(path, mode),
  spawnSync: (cmd: string, args: string[], opts: object) => spawnSync(cmd, args, opts),
  createRequire: () => ({
    resolve: () => {
      if (resolveImpl) return resolveImpl();
      return `/fake/node_modules/@poe-code/freeze-cli/bin/freeze`;
    }
  })
};

describe("resolveFreezeCommand", () => {
  beforeEach(() => {
    existsSync.mockReset();
    accessSync.mockReset();
    spawnSync.mockReset();
    resolveImpl = null;
  });

  it("uses the override path when provided", () => {
    existsSync.mockReturnValue(true);
    spawnSync.mockReturnValue({ status: 1 });

    expect(resolveFreezeCommand({ POE_FREEZE_PATH: "/tmp/freeze" }, deps as any)).toBe(
      "/tmp/freeze"
    );
  });

  it("throws when the override path is missing", () => {
    existsSync.mockReturnValue(false);

    expect(() =>
      resolveFreezeCommand({ POE_FREEZE_PATH: "/tmp/missing" }, deps as any)
    ).toThrow("POE_FREEZE_PATH");
  });

  it("prefers a freeze binary on PATH", () => {
    existsSync.mockImplementation((value: string) => value === "/opt/bin/freeze");
    accessSync.mockImplementation(() => undefined);
    spawnSync.mockReturnValue({ status: 1 });

    expect(resolveFreezeCommand({ PATH: "/opt/bin:/usr/bin" }, deps as any)).toBe(
      "/opt/bin/freeze"
    );
  });

  it("falls back to common system paths when PATH misses freeze", () => {
    existsSync.mockImplementation((value: string) => value === "/opt/homebrew/bin/freeze");
    accessSync.mockImplementation(() => undefined);
    spawnSync.mockImplementation((cmd: string) => ({
      status: cmd === "/opt/homebrew/bin/freeze" ? 0 : 1
    }));

    expect(resolveFreezeCommand({}, deps as any)).toBe("/opt/homebrew/bin/freeze");
  });

  it("skips node_modules/.bin when resolving PATH", () => {
    existsSync.mockImplementation(
      (value: string) =>
        value === "/opt/bin/freeze" || value === "/repo/node_modules/.bin/freeze"
    );
    accessSync.mockImplementation(() => undefined);
    spawnSync.mockReturnValue({ status: 1 });

    expect(
      resolveFreezeCommand({ PATH: "/repo/node_modules/.bin:/opt/bin:/usr/bin" }, deps as any)
    ).toBe("/opt/bin/freeze");
  });

  it("uses system freeze when available", () => {
    existsSync.mockReturnValue(false);
    spawnSync.mockReturnValue({ status: 0 });

    expect(resolveFreezeCommand({}, deps as any)).toBe("freeze");
  });

  it("falls back to bundled freeze-cli binary", () => {
    existsSync.mockReturnValue(false);
    spawnSync.mockReturnValue({ status: 1 });
    resolveImpl = () => `/fake/node_modules/@poe-code/freeze-cli/bin/freeze`;

    const resolved = resolveFreezeCommand({}, deps as any);
    expect(resolved.includes("freeze-cli")).toBe(true);
    expect(resolved.endsWith("bin/freeze")).toBe(true);
  });
});
