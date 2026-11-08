import { describe, expect, it } from "vitest";
import { orderAuthProviders } from "./provider-order.js";
import type { AuthProvider } from "./types.js";

describe("orderAuthProviders", () => {
  it("prefers OAuth-capable defaults, then plain API providers, then providers requiring base URLs", () => {
    const cloudflare = makeProvider({ id: "cloudflare", requiresBaseUrl: true });
    const openai = makeProvider({ id: "openai" });
    const poe = makeProvider({
      id: "poe",
      auth: {
        kind: "api-key",
        envVar: "POE_API_KEY",
        storageKey: "provider:poe",
        prompt: { title: "Poe API key" },
        preferredLogin: "oauth"
      }
    });
    const anthropic = makeProvider({ id: "anthropic" });

    expect(orderAuthProviders([cloudflare, openai, poe, anthropic]).map((provider) => provider.id))
      .toEqual(["poe", "anthropic", "openai", "cloudflare"]);
  });
});

function makeProvider(overrides: Partial<AuthProvider>): AuthProvider {
  return {
    id: "provider",
    label: "Provider",
    auth: {
      kind: "api-key",
      envVar: "PROVIDER_API_KEY",
      storageKey: "provider:test",
      prompt: { title: "Provider API key" }
    },
    ...overrides
  };
}
