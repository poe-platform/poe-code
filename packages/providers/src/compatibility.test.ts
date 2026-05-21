import { describe, expect, it } from "vitest";
import { resolveApiShape } from "./compatibility.js";
import type { ApiShapeId, AuthProvider } from "./types.js";

function makeProvider(apiShapes?: readonly ApiShapeId[]): AuthProvider {
  return {
    id: "provider",
    label: "Provider",
    baseUrl: "https://api.provider.test",
    auth: {
      kind: "api-key",
      envVar: "PROVIDER_API_KEY",
      storageKey: "provider:provider",
      prompt: { title: "Provider API key" }
    },
    apiShapes: apiShapes?.map((id) => ({
      id,
      defaultBaseUrl: `https://api.provider.test/${id}`
    }))
  };
}

describe("resolveApiShape", () => {
  it("returns undefined for an empty provider and agent intersection", () => {
    expect(
      resolveApiShape(makeProvider(["anthropic-messages"]), {
        apiShapes: ["openai-responses"]
      })
    ).toBeUndefined();
  });

  it("respects the agent api shape preference order", () => {
    expect(
      resolveApiShape(makeProvider(["openai-chat-completions", "openai-responses"]), {
        apiShapes: ["openai-responses", "openai-chat-completions"]
      })
    ).toBe("openai-responses");
  });

  it("returns undefined when either side lacks api shapes", () => {
    expect(
      resolveApiShape(makeProvider(["openai-responses"]), {})
    ).toBeUndefined();
    expect(
      resolveApiShape(makeProvider(), { apiShapes: ["openai-responses"] })
    ).toBeUndefined();
  });
});
