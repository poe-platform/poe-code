import { describe, it, expect } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { configure, unconfigure, UnsupportedAgentError } from "./apply.js";
import type { McpServerEntry, ApplyOptions } from "./types.js";

const HOME_DIR = "/home/test";

function createOptions(
  fs: ReturnType<typeof createMockFs>,
  platform: ApplyOptions["platform"] = "darwin"
): ApplyOptions {
  return { fs, homeDir: HOME_DIR, platform };
}

describe("configure", () => {
  describe("claude-code", () => {
    it("configures a new MCP server", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
      };

      await configure("claude-code", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
      expect(content).toEqual({
        mcpServers: {
          "poe-code": {
            command: "npx",
            args: ["poe-code", "mcp"]
          }
        }
      });
    });

    it("merges with existing config", async () => {
      const fs = createMockFs(
        {
          "~/.claude.json": JSON.stringify({
            mcpServers: { existing: { command: "test" } },
            otherKey: "value"
          })
        },
        HOME_DIR
      );
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("claude-code", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
      expect(content).toEqual({
        mcpServers: {
          existing: { command: "test" },
          "poe-code": { command: "npx" }
        },
        otherKey: "value"
      });
    });

    it("removes server when enabled: false", async () => {
      const fs = createMockFs(
        {
          "~/.claude.json": JSON.stringify({
            mcpServers: {
              "poe-code": { command: "npx" },
              other: { command: "test" }
            }
          })
        },
        HOME_DIR
      );
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" },
        enabled: false
      };

      await configure("claude-code", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
      expect(content).toEqual({
        mcpServers: { other: { command: "test" } }
      });
    });

    it("includes env when provided", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: {
          transport: "stdio",
          command: "npx",
          env: { POE_API_KEY: "key123" }
        }
      };

      await configure("claude-code", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
      expect(content.mcpServers["poe-code"]).toEqual({
        command: "npx",
        env: { POE_API_KEY: "key123" }
      });
    });
  });

  describe("claude-desktop", () => {
    it("uses darwin path on macOS", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("claude-desktop", server, createOptions(fs, "darwin"));

      expect(
        fs.exists("/home/test/Library/Application Support/Claude/claude_desktop_config.json")
      ).toBe(true);
    });

    it("uses linux path on linux", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("claude-desktop", server, createOptions(fs, "linux"));

      expect(fs.exists("/home/test/.config/Claude/claude_desktop_config.json")).toBe(true);
    });

    it("uses win32 path on windows", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("claude-desktop", server, createOptions(fs, "win32"));

      expect(
        fs.exists("/home/test/AppData/Roaming/Claude/claude_desktop_config.json")
      ).toBe(true);
    });
  });

  describe("codex", () => {
    it("configures MCP server in TOML format", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
      };

      await configure("codex", server, createOptions(fs));

      const content = fs.getContent("/home/test/.codex/config.toml");
      expect(content).toContain("[mcp_servers.poe-code]");
      expect(content).toContain('command = "npx"');
      // smol-toml adds spaces around array values
      expect(content).toContain('"poe-code"');
      expect(content).toContain('"mcp"');
    });
  });

  describe("opencode", () => {
    it("transforms to opencode shape with type: local", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx", args: ["test"] }
      };

      await configure("opencode", server, createOptions(fs));

      const content = JSON.parse(
        fs.getContent("/home/test/.config/opencode/opencode.json")!
      );
      expect(content).toEqual({
        mcp: {
          "poe-code": {
            type: "local",
            command: ["npx", "test"],
            enabled: true
          }
        }
      });
    });

    it("sets enabled: false in config instead of removing", async () => {
      const fs = createMockFs(
        {
          "~/.config/opencode/opencode.json": JSON.stringify({
            mcp: {
              "poe-code": { type: "local", command: ["npx"], enabled: true }
            }
          })
        },
        HOME_DIR
      );
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" },
        enabled: false
      };

      await configure("opencode", server, createOptions(fs));

      const content = JSON.parse(
        fs.getContent("/home/test/.config/opencode/opencode.json")!
      );
      expect(content.mcp["poe-code"].enabled).toBe(false);
    });
  });

  describe("kimi", () => {
    it("configures MCP server", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("kimi", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.kimi/mcp.json")!);
      expect(content).toEqual({
        mcpServers: {
          "poe-code": { command: "npx" }
        }
      });
    });
  });

  describe("error handling", () => {
    it("throws UnsupportedAgentError for unknown agent", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await expect(
        configure("unknown-agent", server, createOptions(fs))
      ).rejects.toThrow(UnsupportedAgentError);
    });

    it("throws with agent name in error message", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await expect(
        configure("unknown-agent", server, createOptions(fs))
      ).rejects.toThrow("Unsupported agent: unknown-agent");
    });
  });
});

describe("unconfigure", () => {
  it("removes MCP server from claude-code", async () => {
    const fs = createMockFs(
      {
        "~/.claude.json": JSON.stringify({
          mcpServers: {
            "poe-code": { command: "npx" },
            other: { command: "test" }
          }
        })
      },
      HOME_DIR
    );

    await unconfigure("claude-code", "poe-code", createOptions(fs));

    const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
    expect(content).toEqual({
      mcpServers: { other: { command: "test" } }
    });
  });

  it("is no-op when server does not exist", async () => {
    const fs = createMockFs(
      {
        "~/.claude.json": JSON.stringify({
          mcpServers: { other: { command: "test" } }
        })
      },
      HOME_DIR
    );

    await unconfigure("claude-code", "non-existent", createOptions(fs));

    const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
    expect(content).toEqual({
      mcpServers: { other: { command: "test" } }
    });
  });

  it("is no-op when file does not exist", async () => {
    const fs = createMockFs({}, HOME_DIR);

    await expect(
      unconfigure("claude-code", "poe-code", createOptions(fs))
    ).resolves.not.toThrow();
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    const fs = createMockFs({}, HOME_DIR);

    await expect(
      unconfigure("unknown-agent", "test", createOptions(fs))
    ).rejects.toThrow(UnsupportedAgentError);
  });

  it("removes MCP server from codex TOML", async () => {
    const fs = createMockFs(
      {
        "~/.codex/config.toml": `[mcp_servers.poe-code]
command = "npx"

[mcp_servers.other]
command = "test"
`
      },
      HOME_DIR
    );

    await unconfigure("codex", "poe-code", createOptions(fs));

    const content = fs.getContent("/home/test/.codex/config.toml")!;
    expect(content).not.toContain("poe-code");
    expect(content).toContain("[mcp_servers.other]");
  });
});
