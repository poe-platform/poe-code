import { describe, expect, it } from "vitest";
import { allAgents } from "@poe-code/agent-defs";
import { resolveApiShape } from "../compatibility.js";
import { poeProvider } from "./poe.js";

describe("poeProvider", () => {
  it("conforms to AuthProvider shape", () => {
    expect(typeof poeProvider.id).toBe("string");
    expect(typeof poeProvider.label).toBe("string");
    expect(typeof poeProvider.baseUrl).toBe("string");
    expect(Array.isArray(poeProvider.apiShapes)).toBe(true);
  });

  it("uses api-key auth", () => {
    expect(poeProvider.auth.kind).toBe("api-key");
  });

  it("intersects with every Poe-compatible provider-backed agent in @poe-code/agent-defs", () => {
    const poeCompatibleAgents = allAgents.filter(
      (agent) =>
        agent.apiShapes?.some((shapeId) =>
          poeProvider.apiShapes?.some((providerShape) => providerShape.id === shapeId)
        ) ?? false
    );
    expect(poeCompatibleAgents.length).toBeGreaterThan(0);
    for (const agent of poeCompatibleAgents) {
      expect(resolveApiShape(poeProvider, agent)).toBeDefined();
    }
  });

  it("declares Poe API shape defaults", () => {
    expect(poeProvider.apiShapes).toEqual([
      {
        id: "openai-chat-completions",
        defaultBaseUrl: "https://api.poe.com/v1"
      },
      {
        id: "openai-responses",
        defaultBaseUrl: "https://api.poe.com/v1"
      },
      {
        id: "anthropic-messages",
        defaultBaseUrl: "https://api.poe.com/anthropic"
      }
    ]);
  });
});
