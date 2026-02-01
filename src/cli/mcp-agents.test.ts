import { describe, it, expect } from "vitest";
import { supportedAgents } from "@poe-code/agent-mcp-config";
import { MCP_AGENT_PROFILES, getAgentProfile } from "./mcp-agents.js";

describe("mcp agent profiles", () => {
  it("includes known agents with rich content support flags", () => {
    const keys = Object.keys(MCP_AGENT_PROFILES);
    expect(keys).toEqual(
      expect.arrayContaining([
        "claude-code",
        "claude-desktop",
        "codex",
        "cline",
        "kimi",
        "opencode",
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

  it("defines MCP profiles for supported config agents", () => {
    for (const agent of supportedAgents) {
      expect(getAgentProfile(agent)).toBeDefined();
    }
  });
});
