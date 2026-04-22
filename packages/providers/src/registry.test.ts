import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry.js";
import type { AuthProvider } from "./types.js";

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
    expect(registry.forAgent("claude-code").map((p) => p.id)).toEqual([
      "poe",
      "anthropic"
    ]);
    expect(registry.forAgent("codex").map((p) => p.id)).toEqual(["poe", "openai"]);
  });

  it("returns an empty list when no providers support the agent", () => {
    const registry = new ProviderRegistry([anthropic]);
    expect(registry.forAgent("goose")).toEqual([]);
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
});
