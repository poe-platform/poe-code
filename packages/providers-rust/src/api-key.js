const trim = (value) => (typeof value === "string" ? native.providerTrim(value) : value.trim());
import { native } from "./native.js";
function requireApiKeyAuth(provider) {
  if (provider.auth.kind !== "api-key") {
    throw new Error(
      `Provider ${provider.id} does not use api-key auth (got ${provider.auth.kind}).`
    );
  }
  return provider.auth;
}
async function acquireApiKey(provider, options, context) {
  const auth = requireApiKeyAuth(provider);
  const candidate = options.apiKey ?? (await context.promptForSecret?.(auth.prompt));
  const trimmed = candidate == null ? undefined : trim(candidate);
  if (!trimmed) {
    throw new Error(
      `No API key available for provider "${provider.id}". Pass --api-key or run interactively.`
    );
  }
  return trimmed;
}
export const apiKeyAuthStrategy = {
  async login(provider, options, context) {
    const apiKey = await acquireApiKey(provider, options, context);
    await context.secretStore.set(apiKey);
    return apiKey;
  },
  async logout(_provider, context) {
    await context.secretStore.delete();
  },
  async isLoggedIn(_provider, context) {
    const value = await context.secretStore.get({ readOnly: context.readOnly });
    return typeof value === "string" && trim(value).length > 0;
  },
  async resolveCredential(provider, context) {
    requireApiKeyAuth(provider);
    const value = await context.secretStore.get({ readOnly: context.readOnly });
    if (!value || trim(value).length === 0) {
      throw new Error(
        `No stored credential for provider "${provider.id}". Run \`poe-code provider login ${provider.id}\`.`
      );
    }
    return trim(value);
  }
};
