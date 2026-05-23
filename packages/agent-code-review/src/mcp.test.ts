import { describe, expect, it } from "vitest";
import { createCodeReviewAgentMcpConfig } from "./mcp.js";

describe("createCodeReviewAgentMcpConfig", () => {
  it("launches the MCP server through the shipped root executable", () => {
    expect(
      createCodeReviewAgentMcpConfig({
        role: "agent",
        session: "session-1",
        actor: "reviewer",
        cwd: "/repo",
        agent: "codex"
      })
    ).toEqual({
      transport: "stdio",
      command: "poe-code",
      args: [
        "code-review",
        "agent-mcp",
        "--role",
        "agent",
        "--session",
        "session-1",
        "--actor",
        "reviewer",
        "--cwd",
        "/repo",
        "--agent",
        "codex"
      ]
    });
  });
});
