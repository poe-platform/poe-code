import { native } from "./native.js";
export function orderAuthProviders(providers) {
  return Object.freeze([...providers].sort(compareAuthProviders));
}
function compareAuthProviders(left, right) {
  const rankDifference = authProviderRank(left) - authProviderRank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  return left.id.localeCompare(right.id);
}
function authProviderRank(provider) {
  if (provider.auth.kind === "api-key" && provider.auth.preferredLogin === "oauth") {
    return native.providerRank(true, true, false);
  }
  if (provider.requiresBaseUrl === true) {
    return native.providerRank(false, false, true);
  }
  return native.providerRank(false, false, false);
}
