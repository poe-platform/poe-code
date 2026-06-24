import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../cli/http.js";
import {
  createPoeCodeUpdatePlan,
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
