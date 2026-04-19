import { describe, expect, it, vi } from "vitest";
import { installCommand, type InstallResult } from "./install.js";

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

describe("superintendent install command", () => {
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
});
