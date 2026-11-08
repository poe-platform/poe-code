import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as providers from "./index.js";

describe("@poe-code/providers public surface", () => {
  it("exposes ProviderRegistry and the api-key auth strategy", () => {
    expect(typeof providers.ProviderRegistry).toBe("function");
    expect(typeof providers.resolveApiShape).toBe("function");
    expect(providers.anthropicProvider.id).toBe("anthropic");
    expect(providers.cloudflareProvider.id).toBe("cloudflare");
    expect(providers.openaiProvider.id).toBe("openai");
    expect(providers.allAuthProviders.map((provider) => provider.id)).toContain("openai");
    expect(providers.apiKeyAuthStrategy).toMatchObject({
      login: expect.any(Function),
      logout: expect.any(Function),
      isLoggedIn: expect.any(Function),
      resolveCredential: expect.any(Function)
    });
  });

  it("derives allAuthProviders from provider source files", () => {
    const providerFileIds = readdirSync(new URL("./providers", import.meta.url))
      .filter(isProviderSourceFile)
      .map((fileName) => fileName.slice(0, -".ts".length))
      .sort();

    expect(providers.allAuthProviders.map((provider) => provider.id).sort())
      .toEqual(providerFileIds);
  });
});

function isProviderSourceFile(fileName: string): boolean {
  return fileName.endsWith(".ts") &&
    !fileName.endsWith(".test.ts") &&
    fileName !== "generated.ts";
}
