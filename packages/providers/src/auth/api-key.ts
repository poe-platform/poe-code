import type { ApiKeyAuth, AuthProvider } from "../types.js";
import type { AuthStrategy, AuthStrategyContext } from "./types.js";

export interface ApiKeyLoginOptions {
  apiKey?: string;
}

function requireApiKeyAuth(provider: AuthProvider): ApiKeyAuth {
  if (provider.auth.kind !== "api-key") {
    throw new Error(
      `Provider ${provider.id} does not use api-key auth (got ${provider.auth.kind}).`
    );
  }
  return provider.auth;
}

async function acquireApiKey(
  provider: AuthProvider,
  options: ApiKeyLoginOptions,
  context: AuthStrategyContext
): Promise<string> {
  const auth = requireApiKeyAuth(provider);
  const candidate =
    options.apiKey ?? (await context.promptForSecret?.(auth.prompt));
  const trimmed = candidate?.trim();
  if (!trimmed) {
    throw new Error(
      `No API key available for provider "${provider.id}". Pass --api-key or run interactively.`
    );
  }
  return trimmed;
}

export const apiKeyAuthStrategy: AuthStrategy<ApiKeyLoginOptions> = {
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
    return typeof value === "string" && value.trim().length > 0;
  },

  async resolveCredential(provider, context) {
    requireApiKeyAuth(provider);
    const value = await context.secretStore.get({ readOnly: context.readOnly });
    if (!value || value.trim().length === 0) {
      throw new Error(
        `No stored credential for provider "${provider.id}". Run \`poe-code provider login ${provider.id}\`.`
      );
    }
    return value.trim();
  }
};
