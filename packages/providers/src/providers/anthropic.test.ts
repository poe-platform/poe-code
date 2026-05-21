import { describe, expect, it } from "vitest";
import { anthropicProvider } from "./anthropic.js";

describe("anthropicProvider", () => {
  it("conforms to AuthProvider shape", () => {
    expect(typeof anthropicProvider.id).toBe("string");
    expect(typeof anthropicProvider.label).toBe("string");
    expect(typeof anthropicProvider.baseUrl).toBe("string");
    expect(Array.isArray(anthropicProvider.supportsAgents)).toBe(true);
  });

  it("uses api-key auth", () => {
    expect(anthropicProvider.auth.kind).toBe("api-key");
  });

  it("has the correct baseUrl", () => {
    expect(anthropicProvider.baseUrl).toBe("https://api.anthropic.com");
  });

  it("supports claude-code", () => {
    expect(anthropicProvider.supportsAgents).toContain("claude-code");
  });

  it("declares anthropic messages api shape", () => {
    expect(anthropicProvider.apiShapes).toEqual([
      {
        id: "anthropic-messages",
        defaultBaseUrl: "https://api.anthropic.com"
      }
    ]);
  });
});
