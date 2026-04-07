import { describe, it, expect } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import {
  configure,
  unconfigure,
  UnsupportedAgentError
} from "./apply.js";
import type { McpServerEntry, ApplyOptions } from "./types.js";
import { resolveAgentSupport, type AgentMcpConfig } from "./configs.js";
import {
  standardShape,
  opencodeShape,
  getShapeTransformer
} from "./shapes.js";

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

    it("accepts aliases", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("claude", server, createOptions(fs));

      const content = JSON.parse(fs.getContent("/home/test/.claude.json")!);
      expect(content.mcpServers["poe-code"]).toEqual({
        command: "npx"
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

describe("resolveAgentSupport", () => {
  it("does not export documentedAgents", async () => {
    const configsModule = await import("./configs.js");
    expect("documentedAgents" in configsModule).toBe(false);
  });

  it("returns supported for aliases", () => {
    const result = resolveAgentSupport("CLAUDE");
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
  });

  it("returns unknown when no agent matches", () => {
    const result = resolveAgentSupport("unknown-agent");
    expect(result.status).toBe("unknown");
  });

  it("returns unsupported when agent exists but registry lacks config", () => {
    const registry: Record<string, AgentMcpConfig> = {};
    const result = resolveAgentSupport("claude-code", registry);
    expect(result.status).toBe("unsupported");
    expect(result.id).toBe("claude-code");
  });
});

describe("standardShape", () => {
  it("transforms stdio server with command only", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("transforms stdio server with args", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      args: ["poe-code", "mcp"]
    });
  });

  it("transforms stdio server with env", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        env: { POE_API_KEY: "key" }
      }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      env: { POE_API_KEY: "key" }
    });
  });

  it("transforms stdio server with all fields", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["test"],
        env: { KEY: "value" }
      }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      args: ["test"],
      env: { KEY: "value" }
    });
  });

  it("returns undefined for disabled server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: false
    };
    expect(standardShape(entry)).toBeUndefined();
  });

  it("treats enabled: true as enabled", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: true
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("omits empty args array", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: [] }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("omits empty env object", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", env: {} }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("transforms http server to command with url", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "http", url: "http://localhost:3000" }
    };
    expect(standardShape(entry)).toEqual({ command: "http://localhost:3000" });
  });
});

describe("opencodeShape", () => {
  it("transforms stdio server with type: local and array command", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      enabled: true
    });
  });

  it("transforms stdio server with args into single command array", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: ["test"] }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx", "test"],
      enabled: true
    });
  });

  it("transforms stdio server with env", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        env: { KEY: "value" }
      }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      env: { KEY: "value" },
      enabled: true
    });
  });

  it("sets enabled: false for disabled server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: false
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      enabled: false
    });
  });

  it("transforms http server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "http", url: "http://localhost:3000" }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["http://localhost:3000"],
      enabled: true
    });
  });
});

describe("getShapeTransformer", () => {
  it("returns standardShape for standard", () => {
    expect(getShapeTransformer("standard")).toBe(standardShape);
  });

  it("returns opencodeShape for opencode", () => {
    expect(getShapeTransformer("opencode")).toBe(opencodeShape);
  });
});
