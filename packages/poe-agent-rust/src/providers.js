import { native } from "./native.js";
import { getResolvedPluginOptions, setResolvedProviderOptions } from "./provider-metadata.js";
export class ProviderResolutionError extends Error {
  constructor(options) {
    super(native.agentProviderError(options.modelId, options.providerNames, options.providerName), {
      cause: options.cause
    });
    this.name = "ProviderResolutionError";
    this.modelId = options.modelId;
    this.providerNames = [...options.providerNames];
    this.providerName = options.providerName;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
export class DuplicateProviderNameError extends Error {
  constructor(name, entries) {
    super(native.agentDuplicateError(name, entries));
    this.name = "DuplicateProviderNameError";
    this.providerName = name;
    this.pluginEntries = [...entries];
    Error.captureStackTrace?.(this, this.constructor);
  }
}
export function collectProviders(plugins) {
  const state = new native.NativeProviderRegistry(),
    providers = [];
  for (const plugin of plugins) {
    if (!plugin.providers) continue;
    for (const [index, provider] of plugin.providers.entries()) {
      const collision = state.register(provider.name, `${plugin.name}.providers[${index}]`);
      if (collision !== null)
        throw new DuplicateProviderNameError(collision.providerName, collision.pluginEntries);
      providers.push(setResolvedProviderOptions(provider, getResolvedPluginOptions(plugin)));
    }
  }
  return providers;
}
export function resolveProvider(providers, modelId) {
  const names = providers.map((provider) => provider.name),
    state = new native.NativeProviderResolution();
  while (true) {
    const index = state.begin(providers.length);
    if (index === null) throw new ProviderResolutionError({ modelId, providerNames: names });
    const provider = providers[index];
    let supported;
    try {
      supported = provider.supports(modelId);
    } catch (cause) {
      throw new ProviderResolutionError({
        modelId,
        providerNames: names,
        providerName: provider.name,
        cause
      });
    }
    if (state.finish(Boolean(supported)) !== null) return provider;
  }
}
