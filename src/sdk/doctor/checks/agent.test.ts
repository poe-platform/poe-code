import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeFs } from "../../../../tests/test-helpers.js";
import type { FileSystem } from "../../../utils/file-system.js";
import type { DoctorContext } from "../types.js";
import type { ProviderService } from "../../../cli/service-registry.js";
import {
  binaryCheck,
  configProbeCheck,
  modelConfiguredCheck
} from "./agent.js";

const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";

function createContext(
  fs: FileSystem,
  overrides: {
    commandRunner?: (...args: any[]) => Promise<any>;
  } = {}
): DoctorContext {
  return {
    fs,
    env: {
      cwd: "/repo",
      homeDir,
      platform: "darwin",
      configPath,
      logDir: homeDir + "/.poe-code/logs",
      poeApiBaseUrl: "https://api.poe.com/v1",
      poeBaseUrl: "https://api.poe.com",
      variables: {},
      resolveHomePath: (...segments: string[]) =>
        [homeDir, ...segments].join("/"),
      getVariable: () => undefined
    },
    runCommand:
      overrides.commandRunner ??
      vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    httpClient: vi.fn(),
    readApiKey: vi.fn(async () => null),
    verbose: false,
    dryRun: false,
    previousResults: new Map()
  };
}

describe("agent checks", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  describe("binaryCheck", () => {
    it("passes when binary is found via which", async () => {
      const commandRunner = vi.fn(async (command: string) => {
        if (command === "which") {
          return {
            stdout: "/usr/local/bin/claude\n",
            stderr: "",
            exitCode: 0
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });
      const ctx = createContext(fs, { commandRunner });
      const check = binaryCheck("agent:claude-code", "claude-code", "claude");
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when binary is not found", async () => {
      const commandRunner = vi.fn(
        async () => ({ stdout: "", stderr: "", exitCode: 1 })
      );
      const ctx = createContext(fs, { commandRunner });
      const check = binaryCheck("agent:codex", "codex", "codex");
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code install codex");
    });
  });

  describe("configProbeCheck", () => {
    it("passes when config probe file exists", async () => {
      const probePath =
        homeDir + "/.poe-code/codex/config.toml";
      await fs.mkdir(homeDir + "/.poe-code/codex", { recursive: true });
      await fs.writeFile(probePath, "content");
      const ctx = createContext(fs);
      const provider = {
        name: "codex",
        isolatedEnv: {
          agentBinary: "codex",
          configProbe: { kind: "isolatedFile" as const, relativePath: "config.toml" },
          env: {}
        }
      } as unknown as ProviderService;
      const check = configProbeCheck("agent:codex", provider);
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when config probe file is missing", async () => {
      await fs.mkdir(homeDir + "/.poe-code/codex", { recursive: true });
      const ctx = createContext(fs);
      const provider = {
        name: "codex",
        isolatedEnv: {
          agentBinary: "codex",
          configProbe: { kind: "isolatedFile" as const, relativePath: "config.toml" },
          env: {}
        }
      } as unknown as ProviderService;
      const check = configProbeCheck("agent:codex", provider);
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code configure codex");
    });

    it("skips when binary check failed", async () => {
      const ctx = createContext(fs);
      ctx.previousResults.set("agent.codex.binary", {
        status: "fail",
        message: "Binary not found"
      });
      const provider = {
        name: "codex",
        isolatedEnv: {
          agentBinary: "codex",
          configProbe: { kind: "isolatedFile" as const, relativePath: "config.toml" },
          env: {}
        }
      } as unknown as ProviderService;
      const check = configProbeCheck("agent:codex", provider);
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });
  });

  describe("modelConfiguredCheck", () => {
    it("passes when model metadata exists in config", async () => {
      await fs.mkdir(homeDir + "/.poe-code", { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          configured_services: {
            codex: { files: ["~/.codex/config.toml"] }
          }
        })
      );
      const ctx = createContext(fs);
      const check = modelConfiguredCheck("agent:codex", "codex");
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when agent is not in configured services", async () => {
      await fs.mkdir(homeDir + "/.poe-code", { recursive: true });
      await fs.writeFile(configPath, JSON.stringify({}));
      const ctx = createContext(fs);
      const check = modelConfiguredCheck("agent:codex", "codex");
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code configure codex");
    });

    it("skips when config file does not exist", async () => {
      const ctx = createContext(fs);
      const check = modelConfiguredCheck("agent:codex", "codex");
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });
  });
});
