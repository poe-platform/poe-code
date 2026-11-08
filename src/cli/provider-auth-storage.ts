import type { AuthProvider } from "@poe-code/providers";

const PROVIDER_STORAGE_PREFIX = "provider:";

export function providerCredentialFileName(provider: AuthProvider): string {
  return `credentials.${credentialFileSegment(requireApiKeyAuth(provider).storageKey)}.enc`;
}

export function usesLegacyPoeCredentialMirror(provider: AuthProvider): boolean {
  return requireApiKeyAuth(provider).storageKey === "provider:poe";
}

function requireApiKeyAuth(provider: AuthProvider): Extract<AuthProvider["auth"], { kind: "api-key" }> {
  if (provider.auth.kind !== "api-key") {
    throw new Error(`Provider "${provider.id}" does not use api-key credential storage.`);
  }
  return provider.auth;
}

function credentialFileSegment(storageKey: string): string {
  const unprefixed = storageKey.startsWith(PROVIDER_STORAGE_PREFIX)
    ? storageKey.slice(PROVIDER_STORAGE_PREFIX.length)
    : storageKey;
  const sanitized = unprefixed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (sanitized.length === 0) {
    throw new Error(`Provider auth storageKey "${storageKey}" cannot be used for credential storage.`);
  }

  return sanitized;
}
