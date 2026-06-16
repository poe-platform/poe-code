import type { ApiShapeId, AuthProvider } from "./types.js";
import type { SecretStore } from "auth-store";
import { apiKeyAuthStrategy } from "./auth/api-key.js";
import type { ApiKeyLoginOptions } from "./auth/api-key.js";
import type { PromptForSecret } from "./auth/types.js";
import { resolveApiShape } from "./compatibility.js";

export interface LoginContext {
  promptForSecret?: PromptForSecret;
  envVars?: Record<string, string | undefined>;
  store?: SecretStore;
  resolvePreferredLogin?: (input: {
    provider: AuthProvider;
    apiKey?: string;
    envValue?: string;
  }) => Promise<string>;
}

export type ProviderStoreFactory = (provider: AuthProvider) => SecretStore;

export interface ProviderRegistryOptions {
  envVars?: Record<string, string | undefined>;
}

export interface ProviderAgent {
  id: string;
  apiShapes?: readonly ApiShapeId[];
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
    const storageKeys = new Map<string, string>();
    for (const provider of providers) {
      const providerId = provider.id.trim();
      if (providerId.length === 0) {
        throw new Error("Provider id must not be blank.");
      }
      if (provider.id !== providerId) {
        throw new Error(
          `Provider id must not include surrounding whitespace: ${JSON.stringify(provider.id)}`
        );
      }
      if (byId.has(providerId)) {
        throw new Error(`Duplicate provider id: ${providerId}`);
      }
      if (provider.auth.kind === "api-key") {
        if (storageKeys.has(provider.auth.storageKey)) {
          throw new Error(
            `Duplicate provider credential storage key: ${provider.auth.storageKey}`
          );
        }
        storageKeys.set(provider.auth.storageKey, providerId);
      }
      byId.set(providerId, provider);
    }
    this.providers = Object.freeze([...providers]);
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

  forAgent(agent: ProviderAgent): readonly AuthProvider[] {
    return this.providers.filter((provider) => {
      return resolveApiShape(provider, agent) !== undefined;
    });
  }

  async isLoggedIn(id: string, options: { readOnly?: boolean } = {}): Promise<boolean> {
    const provider = this.requireProvider(id);
    if (provider.auth.kind === "api-key") {
      const envValue = readOwnEnvValue(this.envVars, provider.auth.envVar);
      if (typeof envValue === "string" && envValue.trim().length > 0) {
        return true;
      }
    }
    const store = this.requireStore(provider);
    const credential = await store.get({ readOnly: options.readOnly });
    return typeof credential === "string" && credential.trim().length > 0;
  }

  async login(id: string, options: ApiKeyLoginOptions, context?: LoginContext): Promise<void> {
    const provider = this.requireProvider(id);
    const store = context?.store ?? this.requireStore(provider);
    if (provider.auth.kind !== "api-key") {
      throw new Error(`Provider "${id}" does not use api-key auth.`);
    }
    const auth = provider.auth;
    const envApiKey = readOwnEnvValue(context?.envVars ?? this.envVars, auth.envVar);
    const resolvedApiKey =
      options.apiKey ??
      (typeof envApiKey === "string" && envApiKey.trim() ? envApiKey : undefined);
    if (auth.preferredLogin && context?.resolvePreferredLogin) {
      const apiKey = normalizeRequiredCredential(provider.id, await context.resolvePreferredLogin({
        provider,
        apiKey: options.apiKey,
        envValue: typeof envApiKey === "string" ? envApiKey : undefined
      }));
      await store.set(apiKey);
      return;
    }
    await apiKeyAuthStrategy.login(
      provider,
      { apiKey: resolvedApiKey },
      { secretStore: store, promptForSecret: context?.promptForSecret }
    );
  }

  async resolveCredential(
    id: string,
    options: ApiKeyLoginOptions = {},
    context?: Pick<LoginContext, "envVars"> & { readOnly?: boolean }
  ): Promise<string> {
    const provider = this.requireProvider(id);
    if (provider.auth.kind !== "api-key") {
      throw new Error(`Provider "${id}" does not use api-key auth.`);
    }

    if (options.apiKey !== undefined) {
      return normalizeRequiredCredential(provider.id, options.apiKey);
    }

    const envVars = context?.envVars ?? this.envVars;
    const envApiKey = readOwnEnvValue(envVars, provider.auth.envVar);
    if (typeof envApiKey === "string" && envApiKey.trim().length > 0) {
      return envApiKey.trim();
    }

    const store = this.requireStore(provider);
    return apiKeyAuthStrategy.resolveCredential(provider, {
      secretStore: store,
      readOnly: context?.readOnly
    });
  }

  async logout(id: string, options: { store?: SecretStore } = {}): Promise<void> {
    const provider = this.requireProvider(id);
    const store = options.store ?? this.requireStore(provider);
    await store.delete();
  }

  private requireProvider(id: string): AuthProvider {
    const provider = this.byId.get(id);
    if (!provider) {
      throw new Error(`Unknown provider: "${id}".`);
    }
    return provider;
  }

  private requireStore(provider: AuthProvider): SecretStore {
    if (!this.storeFactory) {
      throw new Error(`No store factory configured for ProviderRegistry.`);
    }
    return this.storeFactory(provider);
  }
}

function normalizeRequiredCredential(providerId: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`No API key available for provider "${providerId}".`);
  }
  return trimmed;
}

function readOwnEnvValue(
  envVars: Record<string, string | undefined>,
  name: string
): string | undefined {
  return Object.prototype.hasOwnProperty.call(envVars, name) ? envVars[name] : undefined;
}
