import { describe, expect, it } from "vitest";
import { allAgents } from "@poe-code/agent-defs";
import { poeProvider } from "./poe.js";

describe("poeProvider", () => {
  it("conforms to AuthProvider shape", () => {
    expect(typeof poeProvider.id).toBe("string");
    expect(typeof poeProvider.label).toBe("string");
    expect(typeof poeProvider.baseUrl).toBe("string");
    expect(Array.isArray(poeProvider.supportsAgents)).toBe(true);
  });

  it("uses api-key auth", () => {
    expect(poeProvider.auth.kind).toBe("api-key");
  });

  it("supports every agent in @poe-code/agent-defs", () => {
    const agentIds = allAgents.map((a) => a.id);
    for (const id of agentIds) {
      expect(poeProvider.supportsAgents).toContain(id);
    }
    expect(poeProvider.supportsAgents).toHaveLength(agentIds.length);
  });
});
