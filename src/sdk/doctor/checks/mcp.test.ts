import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeFs } from "../../../../tests/test-helpers.js";
import type { FileSystem } from "../../../utils/file-system.js";
import type { DoctorContext } from "../types.js";
import { mcpConfigValidCheck, mcpCommandExistsCheck } from "./mcp.js";

const homeDir = "/home/test";

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
      configPath: homeDir + "/.poe-code/config.json",
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

describe("MCP checks", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  describe("mcpConfigValidCheck", () => {
    it("passes when MCP config file exists and is valid JSON", async () => {
      const configPath = homeDir + "/.claude.json";
      await fs.writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            "poe-code": {
              command: "npx",
              args: ["--yes", "poe-code", "mcp", "serve"]
            }
          }
        })
      );
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("claude-code", configPath, "json", "mcpServers");
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when MCP config file has invalid JSON", async () => {
      const configPath = homeDir + "/.claude.json";
      await fs.writeFile(configPath, "{broken");
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("claude-code", configPath, "json", "mcpServers");
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
    });

    it("skips when MCP config file does not exist", async () => {
      const configPath = homeDir + "/.claude.json";
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("claude-code", configPath, "json", "mcpServers");
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });

    it("warns when config exists but has no MCP servers key", async () => {
      const configPath = homeDir + "/.claude.json";
      await fs.writeFile(configPath, JSON.stringify({ foo: "bar" }));
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("claude-code", configPath, "json", "mcpServers");
      const result = await check.run(ctx);
      expect(result.status).toBe("warn");
    });
  });

  describe("mcpCommandExistsCheck", () => {
    it("passes when MCP command binary is found", async () => {
      const commandRunner = vi.fn(async (cmd: string) => {
        if (cmd === "which") {
          return { stdout: "/usr/local/bin/npx\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });
      const ctx = createContext(fs, { commandRunner });
      const check = mcpCommandExistsCheck("claude-code", "poe-code", "npx");
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("warns when MCP command binary is not found", async () => {
      const commandRunner = vi.fn(
        async () => ({ stdout: "", stderr: "", exitCode: 1 })
      );
      const ctx = createContext(fs, { commandRunner });
      const check = mcpCommandExistsCheck("claude-code", "poe-code", "npx");
      const result = await check.run(ctx);
      expect(result.status).toBe("warn");
    });
  });
});
