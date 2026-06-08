import { describe, expect, it } from "vitest";
import type { AuthProvider } from "@poe-code/providers";
import { providerCredentialFileName, usesLegacyPoeCredentialMirror } from "./provider-auth-storage.js";

function provider(id: string, storageKey: string): AuthProvider {
  return {
    id,
    label: id,
    baseUrl: `https://${id}.test`,
    auth: {
      kind: "api-key",
      envVar: `${id.toUpperCase()}_API_KEY`,
      storageKey,
      prompt: { title: `${id} API key` }
    }
  };
}

describe("provider auth storage", () => {
  it("keeps provider-prefixed storage keys on the existing credential filenames", () => {
    expect(providerCredentialFileName(provider("anthropic", "provider:anthropic"))).toBe(
      "credentials.anthropic.enc"
    );
  });

  it("derives credential filenames from divergent provider storage keys", () => {
    expect(providerCredentialFileName(provider("example", "provider:shared/example"))).toBe(
      "credentials.shared-example.enc"
    );
  });

  it("uses the legacy Poe credential mirror only for the Poe storage key", () => {
    expect(usesLegacyPoeCredentialMirror(provider("poe", "provider:poe"))).toBe(true);
    expect(usesLegacyPoeCredentialMirror(provider("poe-compatible", "provider:poe-compatible"))).toBe(false);
  });
});
