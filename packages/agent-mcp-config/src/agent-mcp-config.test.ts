import { Volume, createFsFromVolume } from "memfs";
import { describe, it, expect, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { parse as parseYaml } from "yaml";
import { configure, unconfigure, UnsupportedAgentError } from "./apply.js";
import type { McpServerEntry, ApplyOptions } from "./types.js";
import { resolveAgentSupport, type AgentMcpConfig } from "./configs.js";
import { standardShape, opencodeShape, gooseShape, getShapeTransformer } from "./shapes.js";

const HOME_DIR = "/home/test";

function createOptions(
  fs: ReturnType<typeof createMockFs>,
  platform: ApplyOptions["platform"] = "darwin"
): ApplyOptions {
  return { fs, homeDir: HOME_DIR, platform };
}

describe("configure", () => {
  describe("input validation", () => {
    it("rejects blank server names before writing config", async () => {
      for (const name of ["", "   "]) {
        const fs = createMockFs({}, HOME_DIR);

        await expect(
          configure(
            "claude-code",
            { name, config: { transport: "stdio", command: "npx" } },
            createOptions(fs)
          )
        ).rejects.toThrow("MCP server name must be a non-empty string.");

        expect(fs.exists("/home/test/.claude.json")).toBe(false);
      }
    });

    it("rejects whitespace-only stdio commands before writing config", async () => {
      const fs = createMockFs({}, HOME_DIR);

      await expect(
        configure(
          "claude-code",
          { name: "poe-code", config: { transport: "stdio", command: "   " } },
          createOptions(fs)
        )
      ).rejects.toThrow("MCP stdio command must be a non-empty string.");

      expect(fs.exists("/home/test/.claude.json")).toBe(false);
    });

    it("rejects blank and non-http MCP URLs before writing config", async () => {
      for (const url of ["   ", "ftp://example.com/mcp"]) {
        const fs = createMockFs({}, HOME_DIR);

        await expect(
          configure(
            "claude-code",
            { name: "remote", config: { transport: "http", url } },
            createOptions(fs)
          )
        ).rejects.toThrow("MCP HTTP URL must be a valid http or https URL.");

        expect(fs.exists("/home/test/.claude.json")).toBe(false);
      }
    });
  });

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

    it("refuses to overwrite a different user-owned server with the same name", async () => {
      const fs = createMockFs(
        {
          "~/.claude.json": JSON.stringify({
            mcpServers: { "poe-code": { command: "user-custom-command" } }
          })
        },
        HOME_DIR
      );
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
      };

      await expect(configure("claude-code", server, createOptions(fs))).rejects.toThrow(
        'MCP server "poe-code" already exists'
      );

      expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
        mcpServers: { "poe-code": { command: "user-custom-command" } }
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

    it("accepts aliases with surrounding whitespace", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("  CLAUDE  ", server, createOptions(fs));

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

    it("rejects a non-object MCP server container", async () => {
      const fs = createMockFs(
        { "~/.claude.json": JSON.stringify({ mcpServers: ["user-value"], keep: true }) },
        HOME_DIR
      );

      await expect(
        configure(
          "claude-code",
          { name: "poe-code", config: { transport: "stdio", command: "poe-code" } },
          createOptions(fs)
        )
      ).rejects.toThrow("Expected mcpServers to be an object.");

      expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
        mcpServers: ["user-value"],
        keep: true
      });
    });

    it("does not rewrite an identical server definition", async () => {
      const fs = createMockFs(
        { "~/.claude.json": JSON.stringify({ mcpServers: { "poe-code": { command: "npx" } } }) },
        HOME_DIR
      );
      const onComplete = vi.fn();

      await configure(
        "claude-code",
        { name: "poe-code", config: { transport: "stdio", command: "npx" } },
        { ...createOptions(fs), observers: { onComplete } }
      );

      expect(onComplete.mock.calls.map(([, outcome]) => outcome.changed)).toEqual([false, false]);
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

    it("does not remove a different user-owned server when enabled: false", async () => {
      const fs = createMockFs(
        {
          "~/.claude.json": JSON.stringify({
            mcpServers: {
              "poe-code": { command: "user-custom-command" },
              other: { command: "keep" }
            }
          })
        },
        HOME_DIR
      );

      await configure(
        "claude-code",
        {
          name: "poe-code",
          config: { transport: "stdio", command: "npx" },
          enabled: false
        },
        createOptions(fs)
      );

      expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
        mcpServers: {
          "poe-code": { command: "user-custom-command" },
          other: { command: "keep" }
        }
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

      expect(fs.exists("/home/test/AppData/Roaming/Claude/claude_desktop_config.json")).toBe(true);
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

      const content = JSON.parse(fs.getContent("/home/test/.config/opencode/opencode.json")!);
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

      const content = JSON.parse(fs.getContent("/home/test/.config/opencode/opencode.json")!);
      expect(content.mcp["poe-code"].enabled).toBe(false);
    });

    it("refuses to overwrite a different user-owned server when enabled: false", async () => {
      const fs = createMockFs(
        {
          "~/.config/opencode/opencode.json": JSON.stringify({
            mcp: {
              "poe-code": { type: "local", command: ["custom"], enabled: true },
              other: { type: "local", command: ["keep"], enabled: true }
            }
          })
        },
        HOME_DIR
      );

      await expect(
        configure(
          "opencode",
          {
            name: "poe-code",
            config: { transport: "stdio", command: "npx" },
            enabled: false
          },
          createOptions(fs)
        )
      ).rejects.toThrow('MCP server "poe-code" already exists');

      expect(JSON.parse(fs.getContent("/home/test/.config/opencode/opencode.json")!)).toEqual({
        mcp: {
          "poe-code": { type: "local", command: ["custom"], enabled: true },
          other: { type: "local", command: ["keep"], enabled: true }
        }
      });
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

  describe("goose", () => {
    it("merges MCP servers into an existing YAML config", async () => {
      const fs = createMockFs(
        {
          "~/.config/goose/config.yaml": [
            "extensions:",
            "  existing:",
            "    type: stdio",
            "    cmd: uvx",
            "    args:",
            "      - existing-server",
            "otherKey: value"
          ].join("\n")
        },
        HOME_DIR
      );
      const server: McpServerEntry = {
        name: "poe-code",
        config: {
          transport: "stdio",
          command: "npx",
          args: ["poe-code", "mcp"],
          env: { API_KEY: "secret" }
        }
      };

      await configure("goose", server, createOptions(fs));

      const content = parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!);
      expect(content).toEqual({
        extensions: {
          existing: {
            type: "stdio",
            cmd: "uvx",
            args: ["existing-server"]
          },
          "poe-code": {
            type: "stdio",
            cmd: "npx",
            args: ["poe-code", "mcp"],
            envs: { API_KEY: "secret" }
          }
        },
        otherKey: "value"
      });
    });

    it("writes a new YAML config when none exists", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "poe-code",
        config: { transport: "stdio", command: "npx" }
      };

      await configure("goose", server, createOptions(fs));

      const rawContent = fs.getContent("/home/test/.config/goose/config.yaml");
      expect(rawContent).toContain("extensions:");
      expect(parseYaml(rawContent!)).toEqual({
        extensions: {
          "poe-code": {
            type: "stdio",
            cmd: "npx"
          }
        }
      });
    });

    it("preserves existing entries when writing then reading back YAML", async () => {
      const fs = createMockFs({}, HOME_DIR);

      await configure(
        "goose",
        {
          name: "first-server",
          config: { transport: "stdio", command: "npx", args: ["first"] }
        },
        createOptions(fs)
      );

      await configure(
        "goose",
        {
          name: "second-server",
          config: {
            transport: "stdio",
            command: "uvx",
            env: { TOKEN: "abc" }
          }
        },
        createOptions(fs)
      );

      expect(parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!)).toEqual({
        extensions: {
          "first-server": {
            type: "stdio",
            cmd: "npx",
            args: ["first"]
          },
          "second-server": {
            type: "stdio",
            cmd: "uvx",
            envs: { TOKEN: "abc" }
          }
        }
      });
    });

    it("removes a Goose YAML entry when enabled is false", async () => {
      const fs = createMockFs(
        {
          "~/.config/goose/config.yaml": [
            "extensions:",
            "  poe-code:",
            "    type: stdio",
            "    cmd: npx",
            "  other:",
            "    type: stdio",
            "    cmd: uvx",
            "theme: dark"
          ].join("\n")
        },
        HOME_DIR
      );

      await configure(
        "goose",
        {
          name: "poe-code",
          config: { transport: "stdio", command: "npx" },
          enabled: false
        },
        createOptions(fs)
      );

      expect(parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!)).toEqual({
        extensions: {
          other: {
            type: "stdio",
            cmd: "uvx"
          }
        },
        theme: "dark"
      });
    });

    it("reports YAML mutations through observers", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const onStart = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      await configure(
        "goose",
        { name: "poe-code", config: { transport: "stdio", command: "poe-code", args: ["mcp"] } },
        { ...createOptions(fs), observers: { onStart, onComplete, onError } }
      );

      expect(onStart).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
    });

    it("preserves existing YAML when a replacement write fails", async () => {
      const targetPath = "/home/test/.config/goose/config.yaml";
      const previous = "extensions:\n  old:\n    type: stdio\n    cmd: old-command\n";
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: previous }))
        .promises as unknown as ApplyOptions["fs"];
      const fs: ApplyOptions["fs"] = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            await base.writeFile(filePath, "extensions: [", options);
            throw new Error("goose config disk full");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        configure(
          "goose",
          { name: "new", config: { transport: "stdio", command: "new-command" } },
          { fs, homeDir: HOME_DIR, platform: "linux" }
        )
      ).rejects.toThrow("goose config disk full");

      await expect(base.readFile(targetPath, "utf8")).resolves.toBe(previous);
    });

    it("refuses a symlinked YAML target", async () => {
      const targetPath = "/home/test/.config/goose/config.yaml";
      const outsidePath = "/outside/config.yaml";
      const volume = Volume.fromJSON({ [outsidePath]: "outside: true\n" });
      volume.mkdirSync("/home/test/.config/goose", { recursive: true });
      volume.symlinkSync(outsidePath, targetPath);
      const fs = createFsFromVolume(volume).promises as unknown as ApplyOptions["fs"];

      await expect(
        configure(
          "goose",
          { name: "poe-code", config: { transport: "stdio", command: "poe-code" } },
          { fs, homeDir: HOME_DIR, platform: "linux" }
        )
      ).rejects.toThrow("symbolic link");

      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside: true\n");
    });
  });

  describe("error handling", () => {
    it("throws UnsupportedAgentError for unknown agent", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await expect(configure("unknown-agent", server, createOptions(fs))).rejects.toThrow(
        UnsupportedAgentError
      );
    });

    it("throws with agent name in error message", async () => {
      const fs = createMockFs({}, HOME_DIR);
      const server: McpServerEntry = {
        name: "test",
        config: { transport: "stdio", command: "npx" }
      };

      await expect(configure("unknown-agent", server, createOptions(fs))).rejects.toThrow(
        "Unsupported agent: unknown-agent"
      );
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

  it("does not remove a different user-owned server when matching ownership is required", async () => {
    const fs = createMockFs(
      {
        "~/.claude.json": JSON.stringify({
          mcpServers: { "poe-code": { command: "user-custom-command" } }
        })
      },
      HOME_DIR
    );

    await unconfigure(
      "claude-code",
      {
        name: "poe-code",
        config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
      },
      createOptions(fs)
    );

    expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
      mcpServers: { "poe-code": { command: "user-custom-command" } }
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

    await expect(unconfigure("claude-code", "poe-code", createOptions(fs))).resolves.not.toThrow();
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    const fs = createMockFs({}, HOME_DIR);

    await expect(unconfigure("unknown-agent", "test", createOptions(fs))).rejects.toThrow(
      UnsupportedAgentError
    );
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

  it("removes MCP server from goose YAML", async () => {
    const fs = createMockFs(
      {
        "~/.config/goose/config.yaml": [
          "extensions:",
          "  poe-code:",
          "    type: stdio",
          "    cmd: npx",
          "otherKey: value"
        ].join("\n")
      },
      HOME_DIR
    );

    await unconfigure("goose", "poe-code", createOptions(fs));

    expect(parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!)).toEqual({
      otherKey: "value"
    });
  });

  it("does not treat inherited Goose extension names as configured", async () => {
    const fs = createMockFs(
      { "~/.config/goose/config.yaml": "extensions: {}\nother: keep\n" },
      HOME_DIR
    );

    await unconfigure("goose", "constructor", createOptions(fs));

    expect(parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!)).toEqual({
      extensions: {},
      other: "keep"
    });
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

  it("returns supported for whitespace-wrapped aliases", () => {
    const result = resolveAgentSupport("  CLAUDE  ");
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
  });

  it("does not expose mutable registry configuration", async () => {
    const support = resolveAgentSupport("claude-code");

    if (support.status !== "supported" || support.config === undefined) {
      throw new Error("Expected claude-code support");
    }

    support.config.configFile = "~/.redirected/mcp.json";
    const fs = createMockFs({}, HOME_DIR);

    await configure(
      "claude-code",
      { name: "poe-code", config: { transport: "stdio", command: "npx" } },
      createOptions(fs)
    );

    expect(fs.getContent("/home/test/.claude.json")).toBeDefined();
    expect(fs.getContent("/home/test/.redirected/mcp.json")).toBeUndefined();
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

  it("transforms http server with its url and headers", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer secret" }
      }
    };
    expect(standardShape(entry)).toEqual({
      type: "http",
      url: "http://localhost:3000",
      headers: { Authorization: "Bearer secret" }
    });
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

  it("transforms http server as a remote OpenCode MCP", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer secret" }
      }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "remote",
      url: "http://localhost:3000",
      headers: { Authorization: "Bearer secret" },
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

  it("returns gooseShape for goose", () => {
    expect(getShapeTransformer("goose")).toBe(gooseShape);
  });
});

describe("gooseShape", () => {
  it("transforms stdio server fields to Goose keys", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["server"],
        env: { API_KEY: "secret" }
      }
    };

    expect(gooseShape(entry)).toEqual({
      type: "stdio",
      cmd: "npx",
      args: ["server"],
      envs: { API_KEY: "secret" }
    });
  });

  it("omits empty optional Goose fields", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        args: [],
        env: {}
      }
    };

    expect(gooseShape(entry)).toEqual({
      type: "stdio",
      cmd: "npx"
    });
  });

  it("returns undefined for disabled Goose entries", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: false
    };

    expect(gooseShape(entry)).toBeUndefined();
  });
});
