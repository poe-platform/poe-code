import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "@poe-code/config-mutations";
import type { SkillFile } from "@poe-code/agent-skill-config";
import type { McpServerEntry } from "@poe-code/agent-mcp-config";

const installSkill = vi.fn();
const configure = vi.fn();

vi.mock("@poe-code/agent-skill-config", () => ({
  installSkill
}));

vi.mock("@poe-code/agent-mcp-config", () => ({
  configure
}));

const { installMemory } = await import("./install.js");

describe("installMemory", () => {
  beforeEach(() => {
    installSkill.mockReset();
    configure.mockReset();
    installSkill.mockResolvedValue({
      skillPath: "~/.claude/skills/poe-code-memory/SKILL.md",
      displayPath: ".claude/skills/poe-code-memory/SKILL.md"
    });
    configure.mockResolvedValue({
      existed: true,
      path: "/home/test/.mcp.json"
    });
  });

  it("installs both the skill and MCP server by default", async () => {
    const result = await installMemory({
      agent: "claude-code",
      skillContent: "# skill",
      fs: {} as FileSystem,
      cwd: "/repo",
      homeDir: "/home/test",
      platform: "darwin"
    });

    expect(installSkill).toHaveBeenCalledWith(
      "claude-code",
      {
        name: "poe-code-memory",
        content: "# skill"
      } satisfies SkillFile,
      {
        fs: expect.anything(),
        cwd: "/repo",
        homeDir: "/home/test",
        scope: "local",
        dryRun: undefined,
        observers: undefined
      }
    );

    expect(configure).toHaveBeenCalledWith(
      "claude-code",
      {
        name: "poe-code-memory",
        config: {
          transport: "stdio",
          command: "poe-code",
          args: ["memory-mcp"]
        }
      } satisfies McpServerEntry,
      {
        fs: expect.anything(),
        homeDir: "/home/test",
        platform: "darwin",
        dryRun: undefined,
        observers: undefined
      }
    );

    expect(result).toEqual({
      skillInstalled: true,
      mcpConfigured: true,
      skillPath: ".claude/skills/poe-code-memory/SKILL.md",
      mcpConfigPath: "/home/test/.mcp.json"
    });
  });

  it("supports skill-only installs", async () => {
    const result = await installMemory({
      agent: "claude-code",
      skillContent: "# skill",
      fs: {} as FileSystem,
      cwd: "/repo",
      homeDir: "/home/test",
      platform: "darwin",
      skillOnly: true,
      allowWrites: true,
      dryRun: true
    });

    expect(installSkill).toHaveBeenCalledOnce();
    expect(configure).not.toHaveBeenCalled();
    expect(result).toEqual({
      skillInstalled: true,
      mcpConfigured: false,
      skillPath: ".claude/skills/poe-code-memory/SKILL.md",
      mcpConfigPath: undefined
    });
  });

  it("supports mcp-only installs and forwards allow-writes", async () => {
    configure.mockResolvedValue({
      existed: true,
      path: "/home/test/.config/codex/mcp-config.json"
    });

    const result = await installMemory({
      agent: "codex",
      skillContent: "# ignored",
      fs: {} as FileSystem,
      cwd: "/repo",
      homeDir: "/home/test",
      platform: "linux",
      scope: "global",
      mcpOnly: true,
      allowWrites: true
    });

    expect(installSkill).not.toHaveBeenCalled();
    expect(configure).toHaveBeenCalledWith(
      "codex",
      {
        name: "poe-code-memory",
        config: {
          transport: "stdio",
          command: "poe-code",
          args: ["memory-mcp", "--allow-writes"]
        }
      },
      {
        fs: expect.anything(),
        homeDir: "/home/test",
        platform: "linux",
        dryRun: undefined,
        observers: undefined
      }
    );
    expect(result).toEqual({
      skillInstalled: false,
      mcpConfigured: true,
      skillPath: undefined,
      mcpConfigPath: "/home/test/.config/codex/mcp-config.json"
    });
  });

  it("passes scope through to skill installs", async () => {
    await installMemory({
      agent: "claude-code",
      skillContent: "# skill",
      fs: {} as FileSystem,
      cwd: "/repo",
      homeDir: "/home/test",
      platform: "darwin",
      scope: "global"
    });

    expect(installSkill).toHaveBeenCalledWith(
      "claude-code",
      expect.anything(),
      expect.objectContaining({ scope: "global" })
    );
  });

  it("rejects mutually exclusive partial-install flags", async () => {
    await expect(
      installMemory({
        agent: "claude-code",
        skillContent: "# skill",
        fs: {} as FileSystem,
        cwd: "/repo",
        homeDir: "/home/test",
        platform: "darwin",
        skillOnly: true,
        mcpOnly: true
      })
    ).rejects.toThrow("--skill-only and --mcp-only cannot be combined.");
  });
});
