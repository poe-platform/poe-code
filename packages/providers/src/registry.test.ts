import { describe, expect, it } from "vitest";
import { allAgents } from "@poe-code/agent-defs";
import { ProviderRegistry } from "./registry.js";
import { poeProvider } from "./providers/poe.js";
import type { ApiShapeId, AuthProvider } from "./types.js";

function makeProvider(
  overrides: Partial<AuthProvider> & Pick<AuthProvider, "id">
): AuthProvider {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    baseUrl: overrides.baseUrl ?? `https://api.${overrides.id}.test`,
    auth: overrides.auth ?? {
      kind: "api-key",
      envVar: `${overrides.id.toUpperCase()}_API_KEY`,
      storageKey: `provider:${overrides.id}`,
      prompt: { title: `${overrides.id} API key` }
    },
    apiShapes: overrides.apiShapes,
    summary: overrides.summary,
    env: overrides.env
  };
}

describe("ProviderRegistry", () => {
  const poe = makeProvider({
    id: "poe",
    apiShapes: makeApiShapeBindings([
      "anthropic-messages",
      "openai-chat-completions",
      "openai-responses"
    ])
  });
  const anthropic = makeProvider({
    id: "anthropic",
    apiShapes: makeApiShapeBindings(["anthropic-messages"])
  });
  const openai = makeProvider({
    id: "openai",
    apiShapes: makeApiShapeBindings(["openai-responses"])
  });

  it("lists providers in construction order", () => {
    const registry = new ProviderRegistry([poe, anthropic, openai]);
    expect(registry.list().map((p) => p.id)).toEqual(["poe", "anthropic", "openai"]);
  });

  it("looks up a provider by id", () => {
    const registry = new ProviderRegistry([poe, anthropic]);
    expect(registry.get("anthropic")).toBe(anthropic);
  });

  it("returns undefined for unknown ids", () => {
    const registry = new ProviderRegistry([poe]);
    expect(registry.get("nope")).toBeUndefined();
  });

  it("filters providers by API shape intersection", () => {
    const registry = new ProviderRegistry([poe, anthropic, openai]);
    expect(
      registry
        .forAgent({ id: "claude-code", apiShapes: ["anthropic-messages"] })
        .map((p) => p.id)
    ).toEqual(["poe", "anthropic"]);
    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["openai-responses"] })
        .map((p) => p.id)
    ).toEqual(["poe", "openai"]);
  });

  it("returns an empty list when no providers intersect with the agent", () => {
    const registry = new ProviderRegistry([anthropic]);
    expect(
      registry.forAgent({ id: "goose", apiShapes: ["openai-chat-completions"] })
    ).toEqual([]);
  });

  it("uses API shape compatibility for provider selection", () => {
    const matching = makeProvider({
      id: "matching",
      apiShapes: makeApiShapeBindings(["openai-responses"])
    });
    const nonMatching = makeProvider({
      id: "non-matching",
      apiShapes: makeApiShapeBindings(["anthropic-messages"])
    });
    const registry = new ProviderRegistry([matching, nonMatching]);

    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["openai-responses"] })
        .map((p) => p.id)
    ).toEqual(["matching"]);
  });

  it("requires provider and agent API shapes", () => {
    const providerWithoutShapes = makeProvider({
      id: "provider-without-shapes"
    });
    const providerWithShapes = makeProvider({
      id: "provider-with-shapes",
      apiShapes: makeApiShapeBindings(["openai-responses"])
    });
    const registry = new ProviderRegistry([providerWithoutShapes, providerWithShapes]);

    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["anthropic-messages"] })
        .map((p) => p.id)
    ).toEqual([]);
    expect(registry.forAgent({ id: "codex" }).map((p) => p.id)).toEqual([]);
  });

  it("ignores providers whose API shapes do not match", () => {
    const emptyShapes = makeProvider({
      id: "empty-shapes",
      apiShapes: []
    });
    const mismatchedShapes = makeProvider({
      id: "mismatched-shapes",
      apiShapes: makeApiShapeBindings(["anthropic-messages"])
    });
    const registry = new ProviderRegistry([emptyShapes, mismatchedShapes]);

    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["openai-responses"] })
        .map((p) => p.id)
    ).toEqual([]);
  });

  it("keeps poe provider selection compatible for agents with declared api shapes", () => {
    const registry = new ProviderRegistry([poeProvider]);
    const providerBackedAgents = allAgents.filter((agent) => agent.apiShapes);

    expect(providerBackedAgents.length).toBeGreaterThan(0);
    for (const agent of providerBackedAgents) {
      expect(registry.forAgent(agent)).toEqual([poeProvider]);
    }
  });

  it("rejects duplicate ids to keep lookups unambiguous", () => {
    expect(
      () => new ProviderRegistry([poe, makeProvider({ id: "poe" })])
    ).toThrow(/duplicate provider id/i);
  });

  it("isLoggedIn throws for unknown provider id", async () => {
    const registry = new ProviderRegistry([poe]);
    await expect(registry.isLoggedIn("nope")).rejects.toThrow(/unknown provider/i);
  });

  it("logout throws for unknown provider id", async () => {
    const registry = new ProviderRegistry([poe]);
    await expect(registry.logout("nope")).rejects.toThrow(/unknown provider/i);
  });

  it("isLoggedIn returns true when api-key env var is set even if store is empty", async () => {
    const emptyStore = {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([poe], () => emptyStore, {
      envVars: { POE_API_KEY: "env-key" }
    });
    await expect(registry.isLoggedIn("poe")).resolves.toBe(true);
  });

  it("isLoggedIn ignores whitespace-only env var values", async () => {
    const emptyStore = {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([poe], () => emptyStore, {
      envVars: { POE_API_KEY: "   " }
    });
    await expect(registry.isLoggedIn("poe")).resolves.toBe(false);
  });

  it("isLoggedIn returns true when store has credential and env var is unset", async () => {
    const store = {
      get: async () => "stored-key",
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([poe], () => store);
    await expect(registry.isLoggedIn("poe")).resolves.toBe(true);
  });

  it("uses preferred login resolver instead of the generic api-key prompt", async () => {
    const promptForSecret = async () => {
      throw new Error("generic prompt should not run");
    };
    const store = {
      get: async () => null,
      set: async (value: string) => {
        stored = value;
      },
      delete: async () => undefined
    };
    let stored: string | null = null;
    const registry = new ProviderRegistry([
      makeProvider({
        id: "poe",
        auth: {
          kind: "api-key",
          envVar: "POE_API_KEY",
          storageKey: "provider:poe",
          prompt: { title: "Poe API key" },
          preferredLogin: "oauth"
        }
      })
    ], () => store);

    await registry.login("poe", {}, {
      promptForSecret,
      resolvePreferredLogin: async () => "sk-from-oauth"
    });

    expect(stored).toBe("sk-from-oauth");
  });

  it("resolves credentials from explicit input, env, then provider store", async () => {
    const store = {
      get: async () => "stored-key",
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([poe], () => store, {
      envVars: { POE_API_KEY: "env-key" }
    });

    await expect(
      registry.resolveCredential("poe", { apiKey: " explicit-key " })
    ).resolves.toBe("explicit-key");
    await expect(registry.resolveCredential("poe")).resolves.toBe("env-key");
    await expect(
      new ProviderRegistry([poe], () => store).resolveCredential("poe")
    ).resolves.toBe("stored-key");
  });

  it("rejects blank explicit credentials", async () => {
    const store = {
      get: async () => "stored-key",
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([poe], () => store);

    await expect(registry.resolveCredential("poe", { apiKey: " " })).rejects.toThrow(
      /No API key available/
    );
  });
});

function makeApiShapeBindings(apiShapes: readonly ApiShapeId[]): AuthProvider["apiShapes"] {
  return apiShapes.map((id) => ({
    id,
    defaultBaseUrl: `https://api.example.test/${id}`
  }));
}
