import { describe, it, expect } from "vitest";
import {
  MCP_AGENT_PROFILES,
  getAgentProfile
} from "./mcp-agents.js";

describe("mcp agent profiles", () => {
  it("includes known agents with rich content support flags", () => {
    const keys = Object.keys(MCP_AGENT_PROFILES);
    expect(keys).toEqual(
      expect.arrayContaining([
        "claude-code",
        "codex",
        "cline",
        "roo-code",
        "gemini-cli",
        "librechat",
        "generic"
      ])
    );

    expect(getAgentProfile("claude-code")?.supportsRichContent).toBe(true);
    expect(getAgentProfile("cline")?.supportsRichContent).toBe(false);
    expect(getAgentProfile("generic")?.supportsRichContent).toBe(false);
  });

  it("returns undefined for unknown agents", () => {
    expect(getAgentProfile("unknown"))
      .toBeUndefined();
  });
});
