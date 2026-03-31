import { describe, expect, it } from "bun:test";
import environment from "./poe-agent-plugin-environment.js";

describe("poe-agent-plugin-environment", () => {
  it("adds cwd and node version when system is missing", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x",
    });

    expect(transformed?.system).toBe(
      `Working directory: /workspace/project\nNode: ${process.version}`,
    );
    expect(transformed?.system).toContain("Working directory: /workspace/project");
    expect(transformed?.system).toContain(`Node: ${process.version}`);
    expect(transformed?.system).not.toContain("undefined");
  });

  it("appends cwd and node version to an existing system prompt", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(transformed?.system).toBe(
      `base-system\nWorking directory: /workspace/project\nNode: ${process.version}`,
    );
  });
});
