import { describe, expect, it } from "bun:test";
import type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult
} from "@poe-code/ralph";

describe("@poe-code/ralph public exports", () => {
  it("exports Ralph SDK types", () => {
    const input: AgentRunInput = {
      agent: "codex",
      prompt: "Loop on this doc",
      cwd: "/repo"
    };
    const result: AgentRunResult = {
      stdout: "",
      stderr: "",
      exitCode: 0
    };
    const options: RalphRunOptions = {
      agent: ["codex", "claude-code"],
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      maxIterations: 3
    };
    const runResult = null as unknown as RalphRunResult;

    expect(input.agent).toBe("codex");
    expect(result.exitCode).toBe(0);
    expect(options.agent).toEqual(["codex", "claude-code"]);

    void runResult;
  });
});
