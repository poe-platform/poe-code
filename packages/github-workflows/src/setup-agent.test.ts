import { describe, expect, it } from "vitest";
import {
  formatCommandFailure,
  resolveWorkflowAgent
} from "./setup-agent.js";
import type { AutomationDefinition } from "./types.js";

describe("setup-agent", () => {
  function createAutomation(partial: Partial<AutomationDefinition>): AutomationDefinition {
    return {
      name: "github-issue-opened",
      prompt: "Prompt",
      ...partial
    };
  }

  it("defaults to codex when the automation does not declare an agent", () => {
    expect(resolveWorkflowAgent(createAutomation({ agent: "" }))).toBe("codex");
  });

  it("returns the declared automation agent", () => {
    expect(resolveWorkflowAgent(createAutomation({ agent: "claude-code" }))).toBe("claude-code");
  });

  it("formats failing poe-code commands with stderr and stdout", () => {
    expect(
      formatCommandFailure("poe-code", ["configure", "codex", "--yes", "--verbose"], {
        exitCode: 127,
        stderr: "missing binary\n",
        stdout: "partial output\n"
      })
    ).toBe(
      [
        "Command failed with exit code 127: poe-code configure codex --yes --verbose",
        "stderr:\nmissing binary",
        "stdout:\npartial output"
      ].join("\n")
    );
  });
});
