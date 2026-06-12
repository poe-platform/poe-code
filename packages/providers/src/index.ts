export type {
  ApiShapeBinding,
  ApiShapeId,
  ApiKeyAuth,
  ApiKeyPrompt,
  AuthMethod,
  AuthProvider,
  EnvValueSource,
  OAuthAuth,
  ProviderModelInput
} from "./types.js";
export { ProviderRegistry } from "./registry.js";
export type {
  AuthStrategy,
  AuthStrategyContext,
  PromptForSecret
} from "./auth/types.js";
export { resolveApiShape } from "./compatibility.js";
export { apiKeyAuthStrategy } from "./auth/api-key.js";
export type { ApiKeyLoginOptions } from "./auth/api-key.js";
export { POE_PROVIDER_ID, poeProvider } from "./providers/poe.js";
export { anthropicProvider } from "./providers/anthropic.js";
export { cloudflareProvider } from "./providers/cloudflare.js";

import { poeProvider } from "./providers/poe.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { cloudflareProvider } from "./providers/cloudflare.js";

export const allAuthProviders = [poeProvider, anthropicProvider, cloudflareProvider] as const;
