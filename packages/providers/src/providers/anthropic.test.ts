import { describe, expect, it } from "vitest";
import { claudeCodeAgent, codexAgent } from "@poe-code/agent-defs";
import { resolveApiShape } from "../compatibility.js";
import { anthropicProvider } from "./anthropic.js";

describe("anthropicProvider", () => {
  it("conforms to AuthProvider shape", () => {
    expect(typeof anthropicProvider.id).toBe("string");
    expect(typeof anthropicProvider.label).toBe("string");
    expect(typeof anthropicProvider.baseUrl).toBe("string");
    expect(Array.isArray(anthropicProvider.apiShapes)).toBe(true);
  });

  it("uses api-key auth", () => {
    expect(anthropicProvider.auth.kind).toBe("api-key");
  });

  it("has the correct baseUrl", () => {
    expect(anthropicProvider.baseUrl).toBe("https://api.anthropic.com");
  });

  it("intersects with claude-code through anthropic messages only", () => {
    expect(resolveApiShape(anthropicProvider, claudeCodeAgent)).toBe("anthropic-messages");
    expect(resolveApiShape(anthropicProvider, codexAgent)).toBeUndefined();
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
