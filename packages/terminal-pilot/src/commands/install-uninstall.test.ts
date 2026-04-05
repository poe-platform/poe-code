import path from "node:path";
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { UserError } from "@poe-code/cmdkit";

const { install } = await import("./install.js");
const { uninstall } = await import("./uninstall.js");

const HOME_DIR = "/home/test";
const CWD = "/project";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

function createCommandContext(fileSystem: FileSystem) {
  return {
    fetch: globalThis.fetch,
    fs: {
      exists: async () => false,
      readFile: async () => "",
      writeFile: async () => undefined
    },
    env: {
      get(): string | undefined {
        return undefined;
      }
    },
    progress(): void {
      return undefined;
    },
    secrets: {},
    terminalPilotInstaller: {
      cwd: CWD,
      fs: fileSystem,
      homeDir: HOME_DIR,
      platform: "darwin" as const
    }
  };
}

describe("terminal-pilot install/uninstall commands", () => {
  it("installs the terminal-pilot skill and MCP server for an explicit local agent install", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          local: true
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      mcpServerName: "terminal-pilot-mcp",
      scope: "local",
      skillPath: ".claude/skills/terminal-pilot/SKILL.md"
    });

    const skill = await fs.readFile(
      path.join(CWD, ".claude/skills/terminal-pilot/SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("name: terminal-pilot");
    expect(skill).toContain("terminal_create_session");

    const mcpConfig = JSON.parse(
      await fs.readFile(path.join(HOME_DIR, ".claude.json"), "utf8")
    );
    expect(mcpConfig).toEqual({
      mcpServers: {
        "terminal-pilot-mcp": {
          command: "npx",
          args: ["terminal-pilot-mcp"]
        }
      }
    });
  });

  it("defaults install scope to local when no scope flag is provided", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "codex"
        }
      })
    ).resolves.toEqual({
      agent: "codex",
      mcpServerName: "terminal-pilot-mcp",
      scope: "local",
      skillPath: ".codex/skills/terminal-pilot/SKILL.md"
    });
  });

  it("installs into the global skill directory when --global is selected", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          global: true
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      mcpServerName: "terminal-pilot-mcp",
      scope: "global",
      skillPath: "~/.claude/skills/terminal-pilot/SKILL.md"
    });

    await expect(
      fs.readFile(
        path.join(HOME_DIR, ".claude/skills/terminal-pilot/SKILL.md"),
        "utf8"
      )
    ).resolves.toContain("name: terminal-pilot");
  });

  it("rejects conflicting local/global scope flags", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          global: true,
          local: true
        }
      })
    ).rejects.toBeInstanceOf(UserError);
  });

  it("rejects unsupported agents even when the handler is invoked directly", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "kimi"
        }
      })
    ).rejects.toThrow("Unsupported agent: kimi");
  });

  it("removes both terminal-pilot skill folders and unregisters the MCP server", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(path.join(HOME_DIR, ".claude/skills/terminal-pilot"), { recursive: true });
    vol.mkdirSync(path.join(CWD, ".claude/skills/terminal-pilot"), { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });
    vol.mkdirSync(HOME_DIR, { recursive: true });
    await fs.writeFile(
      path.join(HOME_DIR, ".claude/skills/terminal-pilot/SKILL.md"),
      "global",
      { encoding: "utf8" }
    );
    await fs.writeFile(
      path.join(CWD, ".claude/skills/terminal-pilot/SKILL.md"),
      "local",
      { encoding: "utf8" }
    );
    await fs.writeFile(
      path.join(HOME_DIR, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          "terminal-pilot-mcp": {
            command: "npx",
            args: ["terminal-pilot-mcp"]
          },
          existing: {
            command: "test"
          }
        }
      }),
      { encoding: "utf8" }
    );

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code"
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      mcpServerName: "terminal-pilot-mcp",
      removedSkillPaths: [
        ".claude/skills/terminal-pilot",
        "~/.claude/skills/terminal-pilot"
      ]
    });

    await expect(
      fs.stat(path.join(CWD, ".claude/skills/terminal-pilot"))
    ).rejects.toThrow("ENOENT");
    await expect(
      fs.stat(path.join(HOME_DIR, ".claude/skills/terminal-pilot"))
    ).rejects.toThrow("ENOENT");

    const mcpConfig = JSON.parse(
      await fs.readFile(path.join(HOME_DIR, ".claude.json"), "utf8")
    );
    expect(mcpConfig).toEqual({
      mcpServers: {
        existing: {
          command: "test"
        }
      }
    });
  });

  it("is a no-op when uninstalling an agent without terminal-pilot configured", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: {
          agent: "codex"
        }
      })
    ).resolves.toEqual({
      agent: "codex",
      mcpServerName: "terminal-pilot-mcp",
      removedSkillPaths: []
    });
  });
});
