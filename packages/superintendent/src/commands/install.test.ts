import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { ensurePlanDirectory, installCommand, type InstallResult } from "./install.js";

const renderPrimitives = {
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    resolved: vi.fn(),
    errorResolved: vi.fn(),
    message: vi.fn()
  },
  renderTable: vi.fn(() => ""),
  getTheme: vi.fn(() => {
    throw new Error("getTheme should not be called");
  }),
  note: vi.fn()
};

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("superintendent install command", () => {
  it("ships canonical superintendent frontmatter instructions in the skill template", async () => {
    const template = await readFile(new URL("../templates/SKILL_superintendent.md", import.meta.url), "utf8");

    expect(template).toContain("<plan-directory>/<name>.md");
    expect(template).toContain("$schema:");
    expect(template).toContain("kind: superintendent");
    expect(template).toContain("version: 1");
  });

  it("has correct command shape", () => {
    expect(installCommand.name).toBe("install");
    expect(installCommand.scope).toEqual(["cli", "sdk"]);
    expect(installCommand.positional).toEqual(["agent"]);
  });

  it("renders rich output for a successful install", () => {
    const result: InstallResult = {
      agent: "claude-code",
      scope: "local",
      skillPath: ".claude/skills/poe-code-superintendent-plan/SKILL.md",
      planDirectory: "docs/plans",
      planDirectoryCreated: true
    };

    installCommand.render!.rich!(result, renderPrimitives);

    expect(renderPrimitives.logger.success).toHaveBeenCalledWith(
      "Installed Superintendent skill for claude-code (local)."
    );
    expect(renderPrimitives.logger.message).toHaveBeenCalledWith(
      "Skill: .claude/skills/poe-code-superintendent-plan/SKILL.md"
    );
    expect(renderPrimitives.logger.message).toHaveBeenCalledWith("Created: docs/plans");
  });

  it("skips plan directory message when it already exists", () => {
    const result: InstallResult = {
      agent: "claude-code",
      scope: "local",
      skillPath: ".claude/skills/poe-code-superintendent-plan/SKILL.md",
      planDirectory: "docs/plans",
      planDirectoryCreated: false
    };

    renderPrimitives.logger.message.mockClear();
    installCommand.render!.rich!(result, renderPrimitives);

    const messageCalls = renderPrimitives.logger.message.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(messageCalls).not.toContain("Created: docs/plans");
  });

  it("renders markdown output", () => {
    const result: InstallResult = {
      agent: "claude-code",
      scope: "global",
      skillPath: "~/.claude/skills/poe-code-superintendent-plan/SKILL.md",
      planDirectory: "~/docs/plans",
      planDirectoryCreated: true
    };

    const markdown = installCommand.render!.markdown!(result, renderPrimitives);

    expect(markdown).toContain("## Superintendent install");
    expect(markdown).toContain("- Agent: claude-code");
    expect(markdown).toContain("- Scope: global");
    expect(markdown).toContain("- Skill: ~/.claude/skills/poe-code-superintendent-plan/SKILL.md");
    expect(markdown).toContain("- Created: ~/docs/plans");
  });

  it("renders dry-run install output as a preview", () => {
    const result: InstallResult = {
      agent: "claude-code",
      scope: "local",
      skillPath: ".claude/skills/poe-code-superintendent-plan/SKILL.md",
      planDirectory: "docs/plans",
      planDirectoryCreated: true,
      dryRun: true
    };

    const markdown = installCommand.render!.markdown!(result, renderPrimitives);

    expect(markdown).toContain("- Dry run: true");
    expect(markdown).toContain("- Would create: docs/plans");
    expect(markdown).not.toContain("- Created: docs/plans");
  });

  it("renders JSON output", () => {
    const result: InstallResult = {
      agent: "codex",
      scope: "local",
      skillPath: ".codex/skills/poe-code-superintendent-plan/SKILL.md",
      planDirectory: "docs/plans",
      planDirectoryCreated: false
    };

    const json = installCommand.render!.json!(result, renderPrimitives);

    expect(json).toEqual(result);
  });

  it("rejects a symlinked parent while scaffolding the plan directory", async () => {
    const volume = Volume.fromJSON({ "/outside/.keep": "" }, "/");
    volume.mkdirSync("/repo/docs", { recursive: true });
    volume.symlinkSync("/outside", "/repo/docs/plans");
    const fs = createFsFromVolume(volume).promises;

    await expect(ensurePlanDirectory("/repo/docs/plans/superintendent-new", {
      lstat: async (targetPath) => {
        const stat = await fs.lstat(targetPath);
        return { isSymbolicLink: () => stat.isSymbolicLink() };
      },
      mkdir: async (targetPath, options) => {
        await fs.mkdir(targetPath, options);
      }
    })).rejects.toThrow(/symbolic link/i);
    await expect(fs.stat("/outside/superintendent-new"))
      .rejects.toThrow();
  });

  it("does not create a missing plan directory during dry run", async () => {
    const mkdir = vi.fn(async () => undefined);
    const result = await withObjectPrototypeCode("ENOENT", () =>
      ensurePlanDirectory("/repo/docs/plans", {
        lstat: async () => {
          const error = new Error("missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        },
        mkdir
      }, true)
    );

    expect(result).toBe(true);
    expect(mkdir).not.toHaveBeenCalled();
  });
});
