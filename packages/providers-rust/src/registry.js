const trim = (value) => (typeof value === "string" ? native.providerTrim(value) : value.trim());
import { native } from "./native.js";
import { apiKeyAuthStrategy } from "./api-key.js";
import { resolveApiShape } from "./compatibility.js";
export class ProviderRegistry {
  providers;
  byId;
  storeFactory;
  envVars;
  constructor(providers, storeFactory, options) {
    const byId = new native.NativeProviderIdentity();
    const references = [];
    const storageKeys = new native.NativeProviderIdentity();
    const opaqueStorageKeys = new Map();
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
        const checkedKey = provider.auth.storageKey;
        if (
          typeof checkedKey === "string"
            ? storageKeys.has(checkedKey)
            : opaqueStorageKeys.has(checkedKey)
        ) {
          throw new Error(`Duplicate provider credential storage key: ${provider.auth.storageKey}`);
        }
        const storedKey = provider.auth.storageKey;
        if (typeof storedKey === "string") storageKeys.insert(storedKey);
        else opaqueStorageKeys.set(storedKey, providerId);
      }
      byId.insert(providerId);
      references.push(provider);
    }
    this.providers = Object.freeze([...providers]);
    this.byId = byId;
    this.references = references;
    this.storeFactory = storeFactory;
    this.envVars = options?.envVars ?? {};
  }
  list() {
    return this.providers;
  }
  get(id) {
    if (typeof id !== "string") return undefined;
    const index = this.byId.get(id);
    return index == null ? undefined : this.references[index];
  }
  forAgent(agent) {
    return this.providers.filter((provider) => {
      return resolveApiShape(provider, agent) !== undefined;
    });
  }
  async isLoggedIn(id, options = {}) {
    const provider = this.requireProvider(id);
    if (provider.auth.kind === "api-key") {
      const envValue = readOwnEnvValue(this.envVars, provider.auth.envVar);
      if (typeof envValue === "string" && trim(envValue).length > 0) {
        return true;
      }
    }
    const store = this.requireStore(provider);
    const credential = await store.get({ readOnly: options.readOnly });
    return typeof credential === "string" && trim(credential).length > 0;
  }
  async login(id, options, context) {
    const provider = this.requireProvider(id);
    const store = context?.store ?? this.requireStore(provider);
    if (provider.auth.kind !== "api-key") {
      throw new Error(`Provider "${id}" does not use api-key auth.`);
    }
    const auth = provider.auth;
    const envApiKey = readOwnEnvValue(context?.envVars ?? this.envVars, auth.envVar);
    const resolvedApiKey =
      options.apiKey ?? (typeof envApiKey === "string" && trim(envApiKey) ? envApiKey : undefined);
    if (auth.preferredLogin && context?.resolvePreferredLogin) {
      const apiKey = normalizeRequiredCredential(
        provider.id,
        await context.resolvePreferredLogin({
          provider,
          apiKey: options.apiKey,
          envValue: typeof envApiKey === "string" ? envApiKey : undefined
        })
      );
      await store.set(apiKey);
      return;
    }
    await apiKeyAuthStrategy.login(
      provider,
      { apiKey: resolvedApiKey },
      { secretStore: store, promptForSecret: context?.promptForSecret }
    );
  }
  async resolveCredential(id, options = {}, context) {
    const provider = this.requireProvider(id);
    if (provider.auth.kind !== "api-key") {
      throw new Error(`Provider "${id}" does not use api-key auth.`);
    }
    if (options.apiKey !== undefined) {
      return normalizeRequiredCredential(provider.id, options.apiKey);
    }
    const envVars = context?.envVars ?? this.envVars;
    const envApiKey = readOwnEnvValue(envVars, provider.auth.envVar);
    if (typeof envApiKey === "string" && trim(envApiKey).length > 0) {
      return trim(envApiKey);
    }
    const store = this.requireStore(provider);
    return apiKeyAuthStrategy.resolveCredential(provider, {
      secretStore: store,
      readOnly: context?.readOnly
    });
  }
  async logout(id, options = {}) {
    const provider = this.requireProvider(id);
    const store = options.store ?? this.requireStore(provider);
    await store.delete();
  }
  requireProvider(id) {
    const index = typeof id === "string" ? this.byId.get(id) : undefined;
    const provider = index == null ? undefined : this.references[index];
    if (!provider) {
      throw new Error(`Unknown provider: "${id}".`);
    }
    return provider;
  }
  requireStore(provider) {
    if (!this.storeFactory) {
      throw new Error(`No store factory configured for ProviderRegistry.`);
    }
    return this.storeFactory(provider);
  }
}
function normalizeRequiredCredential(providerId, value) {
  const trimmed = trim(value);
  if (trimmed.length === 0) {
    throw new Error(`No API key available for provider "${providerId}".`);
  }
  return trimmed;
}
function readOwnEnvValue(envVars, name) {
  return Object.prototype.hasOwnProperty.call(envVars, name) ? envVars[name] : undefined;
}
