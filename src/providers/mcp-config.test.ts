import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

// Mock the execution context module
vi.mock("../utils/execution-context.js", () => ({
  getCurrentExecutionContext: vi.fn(() => ({
    mode: "npx",
    command: {
      command: "npx",
      args: ["--yes", "poe-code"]
    }
  })),
  toMcpServerCommand: vi.fn((execCommand, subcommand) => ({
    command: execCommand.command,
    args: [...execCommand.args, subcommand]
  }))
}));

import { createProvider, type McpValueContext } from "./create-provider.js";
import { getCurrentExecutionContext } from "../utils/execution-context.js";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/home/test", { recursive: true });
  volume.mkdirSync("/home/test/.config/test-provider", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createMockContext(fs: FileSystem) {
  return {
    env: { homeDir: "/home/test" },
    command: {
      fs,
      runCommand: vi.fn(),
      flushDryRun: vi.fn()
    },
    logger: {
      verbose: vi.fn(),
      dryRun: vi.fn()
    }
  };
}

describe("MCP configuration options", () => {
  beforeEach(() => {
    vi.mocked(getCurrentExecutionContext).mockReturnValue({
      mode: "npx",
      command: {
        command: "npx",
        args: ["--yes", "poe-code"]
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("default MCP value (no custom value)", () => {
    it("uses dynamically detected execution context", async () => {
      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider for MCP config",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcpServers"
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers["poe-code"]).toEqual({
        command: "npx",
        args: ["--yes", "poe-code", "mcp"]
      });
    });

    it("updates command when execution context changes", async () => {
      vi.mocked(getCurrentExecutionContext).mockReturnValue({
        mode: "global",
        command: {
          command: "poe-code",
          args: []
        }
      });

      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcpServers"
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcpServers["poe-code"]).toEqual({
        command: "poe-code",
        args: ["mcp"]
      });
    });

    it("handles development mode execution with --prefix", async () => {
      vi.mocked(getCurrentExecutionContext).mockReturnValue({
        mode: "development",
        command: {
          command: "npm",
          args: ["--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--"]
        }
      });

      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcpServers"
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcpServers["poe-code"].command).toBe("npm");
      expect(config.mcpServers["poe-code"].args).toEqual(["--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--", "mcp"]);
    });
  });

  describe("static custom value", () => {
    it("uses provided static value instead of default", async () => {
      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "tools",
          value: {
            "poe-code": {
              binary: "/usr/local/bin/poe-code",
              subcommand: "mcp"
            }
          }
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.tools["poe-code"]).toEqual({
        binary: "/usr/local/bin/poe-code",
        subcommand: "mcp"
      });
    });
  });

  describe("factory function value", () => {
    it("calls factory with execution context", async () => {
      const valueFactory = vi.fn((ctx: McpValueContext) => ({
        "poe-code": {
          type: "local",
          command: [ctx.execCommand.command, ...ctx.execCommand.args, ctx.subcommand],
          enabled: true
        }
      }));

      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcp",
          value: valueFactory
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      expect(valueFactory).toHaveBeenCalledWith({
        execCommand: { command: "npx", args: ["--yes", "poe-code"] },
        subcommand: "mcp"
      });

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcp["poe-code"]).toEqual({
        type: "local",
        command: ["npx", "--yes", "poe-code", "mcp"],
        enabled: true
      });
    });

    it("factory receives updated context on each call", async () => {
      const valueFactory = vi.fn((ctx: McpValueContext) => ({
        "poe-code": {
          command: [ctx.execCommand.command, ...ctx.execCommand.args, ctx.subcommand]
        }
      }));

      const fs = createMemfs();
      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcp",
          value: valueFactory
        }
      });

      const mockContext = createMockContext(fs);

      // First call with npx
      await provider.mcpConfigure!(mockContext as any, {});
      let config = JSON.parse(
        await fs.readFile("/home/test/.config/test-provider/config.json", "utf-8") as string
      );
      expect(config.mcp["poe-code"].command).toEqual(["npx", "--yes", "poe-code", "mcp"]);

      // Change execution context to global
      vi.mocked(getCurrentExecutionContext).mockReturnValue({
        mode: "global",
        command: { command: "poe-code", args: [] }
      });

      // Second call should use new context
      await provider.mcpConfigure!(mockContext as any, {});
      config = JSON.parse(
        await fs.readFile("/home/test/.config/test-provider/config.json", "utf-8") as string
      );
      expect(config.mcp["poe-code"].command).toEqual(["poe-code", "mcp"]);
    });
  });

  describe("unconfigure", () => {
    it("removes poe-code entry from config", async () => {
      const fs = createMemfs();

      // Pre-populate config with MCP entry
      await fs.writeFile(
        "/home/test/.config/test-provider/config.json",
        JSON.stringify({
          mcpServers: {
            "poe-code": { command: "npx", args: ["--yes", "poe-code", "mcp"] },
            "other-server": { command: "other" }
          }
        })
      );

      const provider = createProvider({
        name: "test-provider",
        label: "Test Provider",
        id: "test-provider",
        summary: "Test provider",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcpServers"
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpUnconfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcpServers["poe-code"]).toBeUndefined();
      expect(config.mcpServers["other-server"]).toEqual({ command: "other" });
    });
  });

  describe("different config keys", () => {
    it("supports custom config key like 'mcp' for opencode", async () => {
      const fs = createMemfs();
      const provider = createProvider({
        name: "opencode-like",
        label: "OpenCode-like Provider",
        id: "opencode-like",
        summary: "Test provider with opencode-like config",
        manifest: { configure: [], unconfigure: [] },
        mcp: {
          configFile: "~/.config/test-provider/config.json",
          configKey: "mcp",
          value: (ctx) => ({
            "poe-code": {
              type: "local",
              command: [ctx.execCommand.command, ...ctx.execCommand.args, ctx.subcommand],
              enabled: true
            }
          })
        }
      });

      const mockContext = createMockContext(fs);
      await provider.mcpConfigure!(mockContext as any, {});

      const configContent = await fs.readFile(
        "/home/test/.config/test-provider/config.json",
        "utf-8"
      );
      const config = JSON.parse(configContent as string);

      expect(config.mcp).toBeDefined();
      expect(config.mcpServers).toBeUndefined();
      expect(config.mcp["poe-code"].type).toBe("local");
    });
  });
});
