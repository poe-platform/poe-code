import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderIsolatedEnv } from "./service-registry.js";
import { createCliEnvironment } from "./environment.js";
import { isolatedEnvRunner } from "./isolated-env-runner.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

const env = createCliEnvironment({ cwd: "/repo", homeDir: "/home/test" });

const isolated: ProviderIsolatedEnv = {
  agentBinary: "codex",
  configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
  env: { CODEX_HOME: { kind: "isolatedDir" } }
};

describe("isolatedEnvRunner", () => {
  it("throws when config probe file does not exist", async () => {
    const fs = createMemFs();

    await expect(
      isolatedEnvRunner({
        env,
        providerName: "codex",
        isolated,
        argv: ["node", "cli"],
        fs
      })
    ).rejects.toThrow("codex is not configured");
  });

  it("throws with helpful message referencing the agent name", async () => {
    const fs = createMemFs();

    await expect(
      isolatedEnvRunner({
        env,
        providerName: "opencode",
        isolated: { ...isolated, configProbe: { kind: "isolatedFile", relativePath: "config.json" } },
        argv: ["node", "cli"],
        fs
      })
    ).rejects.toThrow("opencode is not configured");
  });
});
