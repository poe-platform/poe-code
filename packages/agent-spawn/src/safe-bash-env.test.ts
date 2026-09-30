import { describe, expect, it } from "vitest";
import {
  mergeSpawnEnvironment,
  resolveSafeBashBinaryPath,
  resolveSafeBashEnvOverrides
} from "./environment.js";

describe("safe-bash opt-in environment overrides", () => {
  it("is strictly opt-in and returns empty overrides when safeBash is omitted or false", () => {
    expect(resolveSafeBashEnvOverrides({})).toEqual({});
    expect(resolveSafeBashEnvOverrides({ safeBash: undefined, cwd: "/workspace" })).toEqual({});
    expect(resolveSafeBashEnvOverrides({ safeBash: false, cwd: "/workspace" })).toEqual({});
  });

  it("sets SHELL, SAFE_BASH_WORKSPACE_ROOT, and POE_CODE_SAFE_BASH when safeBash is true", () => {
    const overrides = resolveSafeBashEnvOverrides({
      safeBash: true,
      cwd: "/Users/test/workspace",
      safeBashBin: "/custom/bin/safe-bash"
    });

    expect(overrides).toEqual({
      SHELL: "/custom/bin/safe-bash",
      SAFE_BASH_WORKSPACE_ROOT: "/Users/test/workspace",
      POE_CODE_SAFE_BASH: "1"
    });
  });

  it("carries over parent environment variables while applying opt-in safeBash overrides", () => {
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/Users/test",
      CODEX_SANDBOX_MODE: "workspace-write",
      SHELL: "/bin/zsh"
    };

    const defaultMerged = mergeSpawnEnvironment(
      parentEnv,
      resolveSafeBashEnvOverrides({ safeBash: false, cwd: "/Users/test/workspace" })
    );
    expect(defaultMerged.SHELL).toBe("/bin/zsh");
    expect(defaultMerged.SAFE_BASH_WORKSPACE_ROOT).toBeUndefined();

    const optInMerged = mergeSpawnEnvironment(
      parentEnv,
      resolveSafeBashEnvOverrides({
        safeBash: true,
        cwd: "/Users/test/workspace",
        safeBashBin: "/usr/local/bin/safe-bash"
      })
    );
    expect(optInMerged.SHELL).toBe("/usr/local/bin/safe-bash");
    expect(optInMerged.SAFE_BASH_WORKSPACE_ROOT).toBe("/Users/test/workspace");
    expect(optInMerged.POE_CODE_SAFE_BASH).toBe("1");
    expect(optInMerged.CODEX_SANDBOX_MODE).toBe("workspace-write");
    expect(optInMerged.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("resolves a usable safe-bash binary path when no override is passed", () => {
    const binPath = resolveSafeBashBinaryPath();
    expect(typeof binPath).toBe("string");
    expect(binPath.length).toBeGreaterThan(0);
  });
});
