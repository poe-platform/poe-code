import type { AuthProvider } from "./types.js";
import type { SecretStore } from "auth-store";
import { apiKeyAuthStrategy } from "./auth/api-key.js";
import type { ApiKeyLoginOptions } from "./auth/api-key.js";
import type { PromptForSecret } from "./auth/types.js";

export interface LoginContext {
  promptForSecret?: PromptForSecret;
  envVars?: Record<string, string | undefined>;
}

export type ProviderStoreFactory = (providerId: string) => SecretStore;

export interface ProviderRegistryOptions {
  envVars?: Record<string, string | undefined>;
}

export class ProviderRegistry {
  private readonly providers: readonly AuthProvider[];
  private readonly byId: ReadonlyMap<string, AuthProvider>;
  private readonly storeFactory?: ProviderStoreFactory;
  private readonly envVars: Record<string, string | undefined>;

  constructor(
    providers: readonly AuthProvider[],
    storeFactory?: ProviderStoreFactory,
    options?: ProviderRegistryOptions
  ) {
    const byId = new Map<string, AuthProvider>();
    for (const provider of providers) {
      if (byId.has(provider.id)) {
        throw new Error(`Duplicate provider id: ${provider.id}`);
      }
      byId.set(provider.id, provider);
    }
    this.providers = providers;
    this.byId = byId;
    this.storeFactory = storeFactory;
    this.envVars = options?.envVars ?? {};
  }

  list(): readonly AuthProvider[] {
    return this.providers;
  }

  get(id: string): AuthProvider | undefined {
    return this.byId.get(id);
  }

  forAgent(agentId: string): readonly AuthProvider[] {
    return this.providers.filter((provider) =>
      provider.supportsAgents.includes(agentId)
    );
  }

  async isLoggedIn(id: string): Promise<boolean> {
    const provider = this.requireProvider(id);
    if (provider.auth.kind === "api-key") {
      const envValue = this.envVars[provider.auth.envVar];
      if (typeof envValue === "string" && envValue.trim().length > 0) {
        return true;
      }
    }
    const store = this.requireStore(id);
    const credential = await store.get();
    return credential !== null;
  }

  async login(id: string, options: ApiKeyLoginOptions, context?: LoginContext): Promise<void> {
    const provider = this.requireProvider(id);
    const store = this.requireStore(id);
    if (provider.auth.kind !== "api-key") {
      throw new Error(`Provider "${id}" does not use api-key auth.`);
    }
    const auth = provider.auth;
    const envApiKey = context?.envVars?.[auth.envVar];
    const resolvedApiKey =
      options.apiKey ??
      (typeof envApiKey === "string" && envApiKey.trim() ? envApiKey : undefined);
    await apiKeyAuthStrategy.login(
      provider,
      { apiKey: resolvedApiKey },
      { secretStore: store, promptForSecret: context?.promptForSecret }
    );
  }

  async logout(id: string): Promise<void> {
    this.requireProvider(id);
    const store = this.requireStore(id);
    await store.delete();
  }

  private requireProvider(id: string): AuthProvider {
    const provider = this.byId.get(id);
    if (!provider) {
      throw new Error(`Unknown provider: "${id}".`);
    }
    return provider;
  }

  private requireStore(id: string): SecretStore {
    if (!this.storeFactory) {
      throw new Error(`No store factory configured for ProviderRegistry.`);
    }
    return this.storeFactory(id);
  }
}
