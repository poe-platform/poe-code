import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeFs } from "../../../../tests/test-helpers.js";
import type { FileSystem } from "../../../utils/file-system.js";
import type { DoctorContext } from "../types.js";
import { mcpConfigValidCheck } from "./mcp.js";

const homeDir = "/home/test";

function createContext(fs: FileSystem): DoctorContext {
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
    runCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
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

    it("passes when TOML config is valid and has config key", async () => {
      const configPath = homeDir + "/config.toml";
      await fs.writeFile(
        configPath,
        '[mcp_servers.poe-code]\ncommand = "npx"\nargs = ["--yes", "poe-code", "mcp", "serve"]\n'
      );
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("codex", configPath, "toml", "mcp_servers");
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when TOML config has invalid syntax", async () => {
      const configPath = homeDir + "/config.toml";
      await fs.writeFile(configPath, "[invalid\nbroken = ");
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("codex", configPath, "toml", "mcp_servers");
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
    });

    it("warns when TOML config has no config key", async () => {
      const configPath = homeDir + "/config.toml";
      await fs.writeFile(configPath, '[other]\nfoo = "bar"\n');
      const ctx = createContext(fs);
      const check = mcpConfigValidCheck("codex", configPath, "toml", "mcp_servers");
      const result = await check.run(ctx);
      expect(result.status).toBe("warn");
    });
  });
});
