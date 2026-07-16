import { describe, it, expect } from "vitest";
import {
  agentSupportsCapability,
  formatAgentCapabilityError,
  listAgentsWithCapability,
  type AgentCapability
} from "./index.js";

describe("agent capability matrix", () => {
  it("lists canonical ids for a capability", () => {
    expect(listAgentsWithCapability("skill")).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "gemini-cli",
      "opencode",
      "goose"
    ]);
  });

  it("includes aliases when asked so help text matches what users may type", () => {
    expect(listAgentsWithCapability("skill", { includeAliases: true })).toContain("claude");
    expect(listAgentsWithCapability("skill", { includeAliases: true })).toContain("cursor-agent");
    expect(listAgentsWithCapability("skill", { includeAliases: true })).toContain("gemini");
  });

  it("resolves aliases when checking a capability", () => {
    expect(agentSupportsCapability("claude", "skill")).toBe(true);
    expect(agentSupportsCapability("pi-agent", "spawn")).toBe(true);
    expect(agentSupportsCapability("pi", "install")).toBe(false);
    expect(agentSupportsCapability("nope", "spawn")).toBe(false);
  });

  it("records pi as spawn-only", () => {
    expect(listAgentsWithCapability("spawn")).toContain("pi");
    for (const capability of ["configure", "install", "test", "skill", "mcp"] as AgentCapability[]) {
      expect(agentSupportsCapability("pi", capability)).toBe(false);
    }
  });
});

describe("formatAgentCapabilityError", () => {
  it("names the agent noun and lists the agents supporting the command", () => {
    const message = formatAgentCapabilityError({ agent: "notanagent", capability: "install" });
    expect(message).toContain('Unknown agent "notanagent".');
    expect(message).toContain("Agents supporting install:");
    expect(message).toContain("claude-code");
    expect(message).not.toContain("service");
  });

  it("suggests the nearest match for a typo", () => {
    expect(formatAgentCapabilityError({ agent: "claude-cod", capability: "install" })).toContain(
      "Did you mean: claude-code?"
    );
  });

  it("reports a known agent as lacking the capability instead of unknown", () => {
    const message = formatAgentCapabilityError({ agent: "pi", capability: "install" });
    expect(message).toContain('Agent "pi" does not support install.');
    expect(message).toContain("pi supports: spawn.");
    expect(message).not.toContain("Unknown agent");
  });

  it("resolves an alias to its canonical id before reporting", () => {
    const message = formatAgentCapabilityError({ agent: "pi-agent", capability: "skill" });
    expect(message).toContain('Agent "pi" does not support skill.');
  });

  it("reports kimi as configurable but not skill-capable", () => {
    const message = formatAgentCapabilityError({ agent: "kimi", capability: "skill" });
    expect(message).toContain('Agent "kimi" does not support skill.');
    expect(message).toContain("configure");
  });
});
