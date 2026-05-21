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
    supportsAgents: overrides.supportsAgents ?? [],
    apiShapes: overrides.apiShapes,
    summary: overrides.summary,
    env: overrides.env
  };
}

describe("ProviderRegistry", () => {
  const poe = makeProvider({
    id: "poe",
    supportsAgents: ["claude-code", "codex", "kimi"]
  });
  const anthropic = makeProvider({
    id: "anthropic",
    supportsAgents: ["claude-code"]
  });
  const openai = makeProvider({
    id: "openai",
    supportsAgents: ["codex"]
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

  it("filters providers that support a given agent", () => {
    const registry = new ProviderRegistry([poe, anthropic, openai]);
    expect(registry.forAgent({ id: "claude-code" }).map((p) => p.id)).toEqual([
      "poe",
      "anthropic"
    ]);
    expect(registry.forAgent({ id: "codex" }).map((p) => p.id)).toEqual([
      "poe",
      "openai"
    ]);
  });

  it("returns an empty list when no providers support the agent", () => {
    const registry = new ProviderRegistry([anthropic]);
    expect(registry.forAgent({ id: "goose" })).toEqual([]);
  });

  it("uses api shape compatibility when both provider and agent declare shapes", () => {
    const matching = makeProvider({
      id: "matching",
      supportsAgents: ["codex"],
      apiShapes: makeApiShapeBindings(["openai-responses"])
    });
    const nonMatching = makeProvider({
      id: "non-matching",
      supportsAgents: ["codex"],
      apiShapes: makeApiShapeBindings(["anthropic-messages"])
    });
    const registry = new ProviderRegistry([matching, nonMatching]);

    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["openai-responses"] })
        .map((p) => p.id)
    ).toEqual(["matching"]);
  });

  it("falls back to supportsAgents when one side lacks api shapes", () => {
    const providerWithoutShapes = makeProvider({
      id: "provider-without-shapes",
      supportsAgents: ["codex"]
    });
    const providerWithShapes = makeProvider({
      id: "provider-with-shapes",
      supportsAgents: ["codex"],
      apiShapes: makeApiShapeBindings(["openai-responses"])
    });
    const registry = new ProviderRegistry([providerWithoutShapes, providerWithShapes]);

    expect(
      registry
        .forAgent({ id: "codex", apiShapes: ["anthropic-messages"] })
        .map((p) => p.id)
    ).toEqual(["provider-without-shapes"]);
    expect(registry.forAgent({ id: "codex" }).map((p) => p.id)).toEqual([
      "provider-without-shapes",
      "provider-with-shapes"
    ]);
  });

  it("does not fall back to supportsAgents when both sides declare api shapes without a match", () => {
    const emptyShapes = makeProvider({
      id: "empty-shapes",
      supportsAgents: ["codex"],
      apiShapes: []
    });
    const mismatchedShapes = makeProvider({
      id: "mismatched-shapes",
      supportsAgents: ["codex"],
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
});

function makeApiShapeBindings(apiShapes: readonly ApiShapeId[]): AuthProvider["apiShapes"] {
  return apiShapes.map((id) => ({
    id,
    defaultBaseUrl: `https://api.example.test/${id}`
  }));
}
