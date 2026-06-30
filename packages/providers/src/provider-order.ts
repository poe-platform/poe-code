import type { AuthProvider } from "./types.js";

export function orderAuthProviders(providers: readonly AuthProvider[]): readonly AuthProvider[] {
  return Object.freeze([...providers].sort(compareAuthProviders));
}

function compareAuthProviders(left: AuthProvider, right: AuthProvider): number {
  const rankDifference = authProviderRank(left) - authProviderRank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  return left.id.localeCompare(right.id);
}

function authProviderRank(provider: AuthProvider): number {
  if (provider.auth.kind === "api-key" && provider.auth.preferredLogin === "oauth") {
    return 0;
  }
  if (provider.requiresBaseUrl === true) {
    return 2;
  }
  return 1;
}
