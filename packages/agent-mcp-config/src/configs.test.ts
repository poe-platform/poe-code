import { describe, it, expect } from "bun:test";
import { resolveAgentSupport, type AgentMcpConfig } from "./configs.js";

describe("resolveAgentSupport", () => {
  it("does not export documentedAgents", async () => {
    const configsModule = await import("./configs.js");
    expect("documentedAgents" in configsModule).toBe(false);
  });

  it("returns supported for aliases", () => {
    const result = resolveAgentSupport("CLAUDE");
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
  });

  it("returns unknown when no agent matches", () => {
    const result = resolveAgentSupport("unknown-agent");
    expect(result.status).toBe("unknown");
  });

  it("returns unsupported when agent exists but registry lacks config", () => {
    const registry: Record<string, AgentMcpConfig> = {};
    const result = resolveAgentSupport("claude-code", registry);
    expect(result.status).toBe("unsupported");
    expect(result.id).toBe("claude-code");
  });
});
