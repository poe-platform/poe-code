import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../cli/http.js";
import {
  createPoeCodeUpdatePlan,
  detectPoeCodeInstall,
  detectPoeCodePackageManager,
  updatePoeCode,
  type PoeCodeUpdateResult
} from "./update.js";

function createHttpClient(latestVersion: string | null): HttpClient {
  return vi.fn(async () => {
    if (latestVersion === null) {
      throw new Error("registry unavailable");
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: latestVersion } })
    };
  });
}

describe("poe-code update service", () => {
  it.each([
    [{ npm_config_user_agent: "bun/1.2.0 npm/? node/v22" }, "bun"],
    [{ npm_config_user_agent: "pnpm/10.0.0 npm/? node/v22" }, "pnpm"],
    [{ npm_config_user_agent: "yarn/1.22.22 npm/? node/v22" }, "yarn"],
    [{ npm_config_user_agent: "npm/10.9.2 node/v22" }, "npm"],
    [{ npm_execpath: "/Users/test/.bun/bin/bun" }, "bun"],
    [{ npm_execpath: "/Users/test/.local/share/pnpm/pnpm.cjs" }, "pnpm"],
    [{}, "npm"]
  ] as const)("detects %s as %s", (env, expected) => {
    expect(detectPoeCodePackageManager(env)).toBe(expected);
  });

  it.each([
    [
      "npm global prefix",
      "/usr/local/lib/node_modules/poe-code/dist/services/update.js",
      { packageManager: "npm", global: true }
    ],
    [
      "nvm npm global prefix",
      "/Users/test/.nvm/versions/node/v22.22.2/lib/node_modules/poe-code/dist/services/update.js",
      { packageManager: "npm", global: true }
    ],
    [
      "windows npm global prefix",
      "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\poe-code\\dist\\services\\update.js",
      { packageManager: "npm", global: true }
    ],
    [
      "bun global install",
      "/Users/test/.bun/install/global/node_modules/poe-code/dist/services/update.js",
      { packageManager: "bun", global: true }
    ],
    [
      "pnpm global install",
      "/Users/test/Library/pnpm/global/5/node_modules/poe-code/dist/services/update.js",
      { packageManager: "pnpm", global: true }
    ],
    [
      "yarn global install",
      "/Users/test/.config/yarn/global/node_modules/poe-code/dist/services/update.js",
      { packageManager: "yarn", global: true }
    ],
    [
      "local npm install",
      "/repo/node_modules/poe-code/dist/services/update.js",
      { packageManager: "npm", global: false }
    ],
    [
      "local pnpm install",
      "/repo/node_modules/.pnpm/poe-code@4.0.0/node_modules/poe-code/dist/services/update.js",
      { packageManager: "pnpm", global: false }
    ]
  ] as const)("detects the install source from a %s", (_name, installPath, expected) => {
    expect(detectPoeCodeInstall({ installPath, env: {} })).toEqual(expected);
  });

  it("prefers the real install source over the invoking runtime", () => {
    expect(
      detectPoeCodeInstall({
        installPath: "/usr/local/lib/node_modules/poe-code/dist/services/update.js",
        env: { npm_config_user_agent: "pnpm/9.0.0 npm/? node/v22" }
      })
    ).toEqual({ packageManager: "npm", global: true });
  });

  it("falls back to the invoking runtime when the install path is not a package install", () => {
    expect(
      detectPoeCodeInstall({
        installPath: "/Users/test/src/poe-code/src/services/update.ts",
        env: { npm_config_user_agent: "bun/1.2.0 npm/? node/v22" }
      })
    ).toEqual({ packageManager: "bun", global: true });
  });

  it.each([
    ["npm", "npm", ["install", "poe-code@latest"]],
    ["bun", "bun", ["install", "poe-code@latest"]],
    ["pnpm", "pnpm", ["add", "poe-code@latest"]],
    ["yarn", "yarn", ["add", "poe-code@latest"]]
  ] as const)("builds the local %s update command without -g", (manager, command, args) => {
    expect(
      createPoeCodeUpdatePlan({
        packageManager: manager,
        installPath: "/repo/node_modules/poe-code/dist/services/update.js"
      })
    ).toEqual({ packageManager: manager, command, args });
  });

  it("suggests the matching upgrade command for a global pnpm install", () => {
    expect(
      createPoeCodeUpdatePlan({
        installPath: "/Users/test/Library/pnpm/global/5/node_modules/poe-code/dist/services/update.js",
        env: {}
      })
    ).toEqual({
      packageManager: "pnpm",
      command: "pnpm",
      args: ["add", "-g", "poe-code@latest"]
    });
  });

  it.each([
    ["npm", "npm", ["install", "-g", "poe-code@latest"]],
    ["bun", "bun", ["install", "-g", "poe-code@latest"]],
    ["pnpm", "pnpm", ["add", "-g", "poe-code@latest"]],
    ["yarn", "yarn", ["global", "add", "poe-code@latest"]]
  ] as const)("builds the %s update command", (manager, command, args) => {
    expect(createPoeCodeUpdatePlan({ packageManager: manager })).toEqual({
      packageManager: manager,
      command,
      args
    });
  });

  it("skips the installer when the current version is already latest", async () => {
    const runCommand = vi.fn();

    const result = await updatePoeCode({
      currentVersion: "2.0.0",
      httpClient: createHttpClient("2.0.0"),
      runCommand,
      env: {}
    });

    expect(result).toMatchObject<PoeCodeUpdateResult>({
      status: "current",
      plan: createPoeCodeUpdatePlan({ packageManager: "npm" }),
      version: {
        currentVersion: "2.0.0",
        latestVersion: "2.0.0",
        updateAvailable: false
      }
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("runs the installer when forced even if the current version is latest", async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));

    const result = await updatePoeCode({
      currentVersion: "2.0.0",
      httpClient: createHttpClient("2.0.0"),
      runCommand,
      env: {},
      force: true
    });

    expect(result.status).toBe("updated");
    expect(runCommand).toHaveBeenCalledWith("npm", ["install", "-g", "poe-code@latest"]);
  });

  it("still runs the installer when the registry check is unavailable", async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));

    const result = await updatePoeCode({
      currentVersion: "1.0.0",
      httpClient: createHttpClient(null),
      runCommand,
      env: { npm_config_user_agent: "pnpm/10.0.0 npm/? node/v22" }
    });

    expect(result.status).toBe("updated");
    expect(result.version).toBeNull();
    expect(runCommand).toHaveBeenCalledWith("pnpm", ["add", "-g", "poe-code@latest"]);
  });

  it("throws with command output when the installer fails", async () => {
    const runCommand = vi.fn(async () => ({
      exitCode: 1,
      stdout: "install output",
      stderr: "permission denied"
    }));

    await expect(
      updatePoeCode({
        currentVersion: "1.0.0",
        httpClient: createHttpClient("2.0.0"),
        runCommand,
        env: {}
      })
    ).rejects.toThrow(
      [
        "poe-code update failed with exit code 1: npm install -g poe-code@latest",
        "stdout:",
        "install output",
        "stderr:",
        "permission denied"
      ].join("\n")
    );
  });
});
