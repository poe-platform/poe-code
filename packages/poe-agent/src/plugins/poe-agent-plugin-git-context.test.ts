import { beforeEach, describe, expect, it, vi } from "vitest";
import gitContext from "./poe-agent-plugin-git-context.js";

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", () => ({
  runCommand: runCommandMock,
}));

describe("poe-agent-plugin-git-context", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("adds git status and log to the system prompt", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        stdout: "M README.md\n",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "abc1234 feat: plugin hook\n",
        stderr: "",
        exitCode: 0,
      });

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["status", "--short"],
      { cwd: "/workspace/project" },
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["log", "--oneline", "-5"],
      { cwd: "/workspace/project" },
    );

    expect(transformed?.system).toContain("base-system");
    expect(transformed?.system).toContain("## Git context");
    expect(transformed?.system).toContain("M README.md");
    expect(transformed?.system).toContain("abc1234 feat: plugin hook");
  });

  it("keeps git context header when both git commands fail", async () => {
    runCommandMock.mockRejectedValueOnce(new Error("git unavailable")).mockRejectedValueOnce(
      new Error("git unavailable"),
    );

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(transformed?.system).toBe("base-system\n## Git context");
    expect(transformed?.system).not.toContain("undefined");
  });

  it("includes whichever git output succeeds", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        stdout: "M README.md\n",
        stderr: "",
        exitCode: 0,
      })
      .mockRejectedValueOnce(new Error("log failed"));

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
    });

    expect(transformed?.system).toContain("## Git context");
    expect(transformed?.system).toContain("M README.md");
    expect(transformed?.system).not.toContain("undefined");
  });
});
